(async()=>{
  try{
    const pkg = require('@whiskeysockets/baileys') || require('@adiwajshing/baileys');
    console.log('package keys ->', Object.keys(pkg).slice(0,40));
    const useSingle = pkg.useSingleFileAuthState || pkg.useMultiFileAuthState;
    console.log('useSingleFileAuthState type ->', typeof useSingle);
    if(typeof useSingle === 'function'){
      const helper = useSingle('./session.json');
      console.log('helper is array?', Array.isArray(helper));
      if (Array.isArray(helper)) {
        console.log('array length', helper.length);
        console.log('state top keys ->', Object.keys(helper[0]||{}));
      } else {
        console.log('helper keys ->', Object.keys(helper||{}));
        if(helper && helper.state) console.log('state top keys ->', Object.keys(helper.state||{}));
      }
    } else console.log('no useSingleFileAuthState available');
  }catch(e){
    console.error('debug err ->', e && e.message);
  }
})();
