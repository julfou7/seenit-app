const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const sharp=require('sharp');
const root=path.resolve(__dirname,'..');
const brand=path.join(root,'public/brand');
async function generateAll(){
 const icon=fs.readFileSync(path.join(brand,'seenit-icone.svg'),'utf8');
 const ring=fs.readFileSync(path.join(brand,'seenit-anneau.svg'),'utf8');
 const foreground=ring.replace('viewBox="0 0 100 100"','viewBox="0 0 108 108"').replace('<g transform="translate(0.00 0.00) scale(1.0000)">','<g transform="translate(20.52 20.52) scale(0.6696)">');
 const densities=[['mdpi',48,108],['hdpi',72,162],['xhdpi',96,216],['xxhdpi',144,324],['xxxhdpi',192,432]];
 for(const [density,size,fg] of densities){
  const dir=path.join(root,'android/app/src/main/res/mipmap-'+density);fs.mkdirSync(dir,{recursive:true});
  for(const name of ['ic_launcher.png','ic_launcher_round.png']) await sharp(Buffer.from(icon)).resize(size,size).png().toFile(path.join(dir,name));
  await sharp(Buffer.from(foreground)).resize(fg,fg).png().toFile(path.join(dir,'ic_launcher_foreground.png'));
 }
 for(const [name,size] of [['icon-192.png',192],['icon-maskable-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512],['apple-touch-icon.png',180],['favicon.png',64],['logo.png',512]]) await sharp(Buffer.from(icon)).resize(size,size).png().toFile(path.join(root,'public',name));
 const contractPath=path.join(root,'docs/specifications/android-contract.json');
 const contract=JSON.parse(fs.readFileSync(contractPath,'utf8'));
 for(const asset of contract.brandAssets) asset.sha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,asset.path))).digest('hex');
 fs.writeFileSync(contractPath,JSON.stringify(contract,null,2)+'\n');
 console.log('Actifs marque v3 matérialisés, empreintes Android verrouillées ; splash système neutre conservé.');
}
generateAll().catch(error=>{console.error(error);process.exitCode=1});
