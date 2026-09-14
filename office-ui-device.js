(function(){
  'use strict';

  function viewportSize(){
    const vv=window.visualViewport;
    return {
      width:Math.round(vv?.width||window.innerWidth||document.documentElement.clientWidth||0),
      height:Math.round(vv?.height||window.innerHeight||document.documentElement.clientHeight||0)
    };
  }

  function deviceProfile(){
    const {width,height}=viewportSize();
    const coarse=!!window.matchMedia?.('(pointer: coarse)').matches;
    const hover=!!window.matchMedia?.('(hover: hover)').matches;
    const portrait=height>=width;
    let device='desktop';

    if(width<=650) device='phone';
    else if(width<=1024 || (coarse && width<=1180)) device='tablet';
    else if(width<=1440) device='notebook';

    return {
      device,
      width,
      height,
      orientation:portrait?'portrait':'landscape',
      input:coarse&&!hover?'touch':coarse?'hybrid':'pointer'
    };
  }

  let lastKey='';
  function applyDeviceProfile(){
    const p=deviceProfile();
    const root=document.documentElement;
    const key=[p.device,p.orientation,p.input,p.width,p.height].join(':');
    root.setAttribute('data-lex-device',p.device);
    root.setAttribute('data-lex-orientation',p.orientation);
    root.setAttribute('data-lex-input',p.input);
    root.style.setProperty('--lex-vw',`${p.width}px`);
    root.style.setProperty('--lex-vh',`${p.height}px`);
    if(key!==lastKey){
      lastKey=key;
      window.dispatchEvent(new CustomEvent('lex:devicechange',{detail:p}));
    }
    return p;
  }

  let raf=0;
  function scheduleApply(){
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(applyDeviceProfile);
  }

  window.lexDeviceProfile=deviceProfile;
  window.lexApplyDeviceProfile=applyDeviceProfile;

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',applyDeviceProfile,{once:true});
  else applyDeviceProfile();

  window.addEventListener('resize',scheduleApply,{passive:true});
  window.addEventListener('orientationchange',scheduleApply,{passive:true});
  window.visualViewport?.addEventListener('resize',scheduleApply,{passive:true});
})();
