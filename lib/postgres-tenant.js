'use strict';

const {TENANT_CONFLICTS,normalizeTenantId,assertTableIsolated,activeTenantTables}=require('./supabase');

const MODIFIERS=new Set(['select','order','limit','offset','on_conflict']);
const SHARED_POOLS=new Map();

function identifier(value){
  const name=String(value||'');
  if(!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Identificador SQL invalido');
  return '"'+name+'"';
}

function selectList(value){
  if(!value || value==='*') return '*';
  return String(value).split(',').map(x=>identifier(x.trim())).join(',');
}

function positiveInt(value,fallback=null,max=10000){
  if(value===undefined||value===null||value==='') return fallback;
  const n=Number(value);
  if(!Number.isInteger(n)||n<0||n>max) throw new Error('Limite SQL invalido');
  return n;
}

function parseOrder(value){
  if(!value) return '';
  const parts=String(value).split(',').filter(Boolean).map(part=>{
    const [column,direction='asc']=part.trim().split('.');
    const dir=String(direction).toLowerCase();
    if(!['asc','desc'].includes(dir)) throw new Error('Ordenacao SQL invalida');
    return identifier(column)+' '+dir.toUpperCase();
  });
  return parts.length?' ORDER BY '+parts.join(', '):'';
}

function addFilter(clauses,values,column,raw){
  const value=String(raw??'');
  const operators=[
    ['eq.','='],
    ['gt.','>'],
    ['like.','LIKE']
  ];
  const selected=operators.find(([prefix])=>value.startsWith(prefix));
  if(!selected) throw new Error('Filtro SQL nao suportado');
  const [prefix,operator]=selected;
  let actual=value.slice(prefix.length);
  if(prefix==='like.') actual=actual.replaceAll('*','%');
  values.push(actual);
  clauses.push(identifier(column)+' '+operator+' $'+values.length);
}

function whereClause(query,values,{requireBusinessFilter=false}={}){
  const clauses=[];
  let businessFilters=0;
  for(const [column,raw] of Object.entries(query||{})){
    if(MODIFIERS.has(column)||raw===undefined||raw===null) continue;
    addFilter(clauses,values,column,raw);
    if(column!=='escritorio_id') businessFilters++;
  }
  if(requireBusinessFilter && !businessFilters) throw new Error('Operacao sem filtro de negocio bloqueada');
  return clauses.length?' WHERE '+clauses.join(' AND '):'';
}

function preference(headers){
  const source=Object.entries(headers||{}).find(([key])=>key.toLowerCase()==='prefer')?.[1]||'';
  const text=String(source).toLowerCase();
  return {
    representation:text.includes('return=representation'),
    merge:text.includes('resolution=merge-duplicates'),
    ignore:text.includes('resolution=ignore-duplicates')
  };
}

function normalizeConflict(table,value){
  if(!value) return null;
  const normalized=String(value).split(',').map(x=>x.trim()).filter(Boolean).join(',');
  const spec=TENANT_CONFLICTS[table];
  if(spec && (normalized===spec.legacy||normalized===spec.composite)) return spec.composite;
  return normalized;
}

function tenantizeInput(method,table,data,query,tenantId){
  const tenant=normalizeTenantId(tenantId);
  if(!tenant) throw new Error('Tenant obrigatorio no PostgreSQL');
  const tenantTables=activeTenantTables();
  assertTableIsolated(table,true,tenantTables);
  const tenantScoped=tenantTables.has(table);
  const q={...(query||{})};
  let payload=data;

  if(tenantScoped){
    if(q.escritorio_id && q.escritorio_id!=='eq.'+tenant) throw new Error('Tenant divergente na consulta');
    if(method!=='POST') q.escritorio_id='eq.'+tenant;
    if(q.on_conflict) q.on_conflict=normalizeConflict(table,q.on_conflict);

    if(payload!=null&&['POST','PATCH','PUT'].includes(method)){
      const inject=row=>{
        if(!row||typeof row!=='object'||Array.isArray(row)) throw new Error('Payload tenant invalido');
        if(row.escritorio_id&&String(row.escritorio_id).toLowerCase()!==tenant) throw new Error('Tenant divergente no payload');
        return {...row,escritorio_id:tenant};
      };
      payload=Array.isArray(payload)?payload.map(inject):inject(payload);
    }
  }
  return {tenant,q,payload};
}

function sqlInsert(table,payload,query,headers){
  const rows=Array.isArray(payload)?payload:[payload];
  if(!rows.length) throw new Error('Insert vazio');
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row||{})))];
  if(!columns.length) throw new Error('Insert sem colunas');
  columns.forEach(identifier);

  const values=[];
  const groups=rows.map(row=>'('+columns.map(column=>{
    values.push(row?.[column]??null);
    return '$'+values.length;
  }).join(',')+')');

  let sql='INSERT INTO '+identifier(table)+' ('+columns.map(identifier).join(',')+') VALUES '+groups.join(',');
  const conflict=normalizeConflict(table,query?.on_conflict);
  const pref=preference(headers);
  if(conflict){
    const conflictCols=conflict.split(',').map(x=>x.trim()).filter(Boolean);
    conflictCols.forEach(identifier);
    if(pref.ignore){
      sql+=' ON CONFLICT ('+conflictCols.map(identifier).join(',')+') DO NOTHING';
    }else if(pref.merge){
      const updates=columns.filter(c=>!conflictCols.includes(c));
      sql+=' ON CONFLICT ('+conflictCols.map(identifier).join(',')+') ';
      sql+=updates.length
        ?'DO UPDATE SET '+updates.map(c=>identifier(c)+'=EXCLUDED.'+identifier(c)).join(',')
        :'DO NOTHING';
    }
  }
  if(pref.representation) sql+=' RETURNING *';
  return {sql,values,representation:pref.representation};
}

function sqlUpdate(table,payload,query,headers){
  if(!payload||Array.isArray(payload)||typeof payload!=='object') throw new Error('Patch invalido');
  const entries=Object.entries(payload);
  if(!entries.length) throw new Error('Patch vazio');
  const values=[];
  const sets=entries.map(([column,value])=>{
    values.push(value);
    return identifier(column)+'=$'+values.length;
  });
  const where=whereClause(query,values,{requireBusinessFilter:true});
  let sql='UPDATE '+identifier(table)+' SET '+sets.join(',')+where;
  const pref=preference(headers);
  if(pref.representation) sql+=' RETURNING *';
  return {sql,values,representation:pref.representation};
}

function sqlDelete(table,query,headers){
  const values=[];
  const where=whereClause(query,values,{requireBusinessFilter:true});
  let sql='DELETE FROM '+identifier(table)+where;
  const pref=preference(headers);
  if(pref.representation) sql+=' RETURNING *';
  return {sql,values,representation:pref.representation};
}

function sqlSelect(table,query){
  const values=[];
  const where=whereClause(query,values);
  const order=parseOrder(query?.order);
  const limit=positiveInt(query?.limit,null,10000);
  const offset=positiveInt(query?.offset,null,1000000);
  let sql='SELECT '+selectList(query?.select)+' FROM '+identifier(table)+where+order;
  if(limit!==null) sql+=' LIMIT '+limit;
  if(offset!==null) sql+=' OFFSET '+offset;
  return {sql,values,representation:true};
}

function postgresError(error){
  const code=String(error?.code||'');
  const status=code==='23505'?409:code==='42501'?403:code.startsWith('23')?422:503;
  const safe=error?.lexSafeMessage||(
    status===409?'Conflito ao gravar no banco.':
    status===403?'Operacao recusada pelo isolamento do banco.':
    status===422?'Dados recusados pelo banco.':
    'Banco PostgreSQL indisponivel ou operacao recusada.'
  );
  return {ok:false,status,body:null,erro:safe,code:code||undefined};
}

function createTenantPostgresRequest({
  connectionString=process.env.LEX_DATABASE_URL,
  tenantId=process.env.LEX_ESCRITORIO_ID,
  pool=null,
  Pool=null,
  max=5,
  statementTimeoutMs=15000
}={}){
  const tenant=normalizeTenantId(tenantId);
  if(!tenant) throw new Error('LEX_ESCRITORIO_ID obrigatorio para PostgreSQL');
  let ownedPool=false;
  let db=pool;

  if(!db){
    if(!connectionString) throw new Error('LEX_DATABASE_URL obrigatoria para PostgreSQL');
    let PoolCtor=Pool;
    if(!PoolCtor) ({Pool:PoolCtor}=require('pg'));
    const poolKey=connectionString;
    if(!SHARED_POOLS.has(poolKey)){
      SHARED_POOLS.set(poolKey,new PoolCtor({
        connectionString,
        max,
        application_name:'lex-juridico',
        connectionTimeoutMillis:10000,
        idleTimeoutMillis:30000
      }));
    }
    db=SHARED_POOLS.get(poolKey);
  }

  const request=async function(method,table,data,query,headers){
    let client;
    try{
      if(!/^[a-z_][a-z0-9_]*$/i.test(String(table||''))) throw new Error('Tabela invalida');
      const input=tenantizeInput(method,table,data,query,tenant);
      client=await db.connect();
      await client.query('BEGIN');

      const guard=await client.query(
        `select current_user as role,
                coalesce((select rolbypassrls from pg_roles where rolname=current_user),true) as bypass,
                pg_has_role(current_user,'lex_backend','member') as backend_member`
      );
      const identity=guard.rows?.[0]||{};
      if(identity.bypass===true||identity.bypass==='t'||identity.backend_member===false||identity.backend_member==='f'){
        const error=new Error('unsafe database role');
        error.lexSafeMessage='Conexao PostgreSQL recusada: role sem isolamento RLS.';
        throw error;
      }

      await client.query("select set_config('lex.escritorio_id',$1,true)",[tenant]);
      await client.query("select set_config('statement_timeout',$1,true)",[String(statementTimeoutMs)]);

      let built;
      if(method==='GET') built=sqlSelect(table,input.q);
      else if(method==='POST') built=sqlInsert(table,input.payload,input.q,headers);
      else if(method==='PATCH') built=sqlUpdate(table,input.payload,input.q,headers);
      else if(method==='DELETE') built=sqlDelete(table,input.q,headers);
      else throw Object.assign(new Error('Metodo PostgreSQL nao suportado'),{lexSafeMessage:'Metodo de banco nao suportado.'});

      const result=await client.query(built.sql,built.values);
      await client.query('COMMIT');
      return {
        ok:true,
        status:method==='POST'?201:200,
        body:built.representation?(result.rows||[]):null
      };
    }catch(error){
      if(client){try{await client.query('ROLLBACK');}catch{}}
      return postgresError(error);
    }finally{
      try{client?.release?.();}catch{}
    }
  };

  request.mode='postgres';
  request.close=async()=>{if(ownedPool&&db?.end) await db.end();};
  request.pool=db;
  return request;
}

module.exports={
  createTenantPostgresRequest,
  tenantizeInput,
  sqlSelect,
  sqlInsert,
  sqlUpdate,
  sqlDelete,
  postgresError
};
