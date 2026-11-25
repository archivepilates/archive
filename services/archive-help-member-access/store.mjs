import { DatabaseSync } from 'node:sqlite';
import { closeSync,lstatSync,openSync,realpathSync } from 'node:fs';
import { dirname,isAbsolute,normalize } from 'node:path';

const kinds=new Set(['binding','member-index','invite','invite-index','challenge','flow','credential','credential-index','session','budget','otp','otp-budget','otp-receipt']);
const validKey=(kind,key)=>kinds.has(kind)&&typeof key==='string'&&/^[a-f0-9]{64}$/.test(key);

export function openMemberStore(path){
  if(!isAbsolute(path)||normalize(path)!==path)throw Error('Absolute canonical store path required');
  const directory=dirname(path), parent=lstatSync(directory);
  if(!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o077)||realpathSync(directory)!==directory){
    throw Error('Owner-only directory required');
  }
  try{closeSync(openSync(path,'ax',0o600));}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const info=lstatSync(path);
  if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o077)||info.nlink!==1)throw Error('Owner-only store file required');
  const db=new DatabaseSync(path);
  try{
    db.exec(`PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER, PRIMARY KEY(kind,key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS checkout_expires ON records(expires) WHERE expires IS NOT NULL;`);
  }catch(error){db.close();throw error;}
  const select=db.prepare('SELECT value FROM records WHERE kind=? AND key=? AND (expires IS NULL OR expires>?)');
  const write=db.prepare(`INSERT INTO records(kind,key,value,expires) VALUES(?,?,?,?)
    ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,expires=excluded.expires`);
  const deletion=db.prepare('DELETE FROM records WHERE kind=? AND key=?');
  const expiry=db.prepare('DELETE FROM records WHERE expires<=?');
  const read=(kind,key,now)=>validKey(kind,key)?JSON.parse(select.get(kind,key,now)?.value??'null'):null;
  const put=(kind,key,data,expires=null)=>{
    if(!validKey(kind,key)||expires!==null&&(!Number.isSafeInteger(expires)||expires<=0))throw Error('Invalid record');
    const value=JSON.stringify(data);
    if(!value||Buffer.byteLength(value)>12000)throw Error('Record size exceeded');
    write.run(kind,key,value,expires);
  };
  let tail=Promise.resolve(), pending=0;
  const serialize=run=>{
    pending++;
    const result=tail.then(run).finally(()=>{pending--;});
    tail=result.catch(()=>{});
    return result;
  };
  return Object.freeze({
    read:(kind,key,now)=>serialize(()=>read(kind,key,now)),
    transaction(run){
      return serialize(async()=>{
        db.exec('BEGIN IMMEDIATE');
        let active=true;
        const onlyActive=operation=>async(...args)=>{
          if(!active)throw Error('Store transaction is no longer active');
          return operation(...args);
        };
        const tx=Object.freeze({
          read:onlyActive(read),
          put:onlyActive(put),
          remove:onlyActive((kind,key)=>{if(validKey(kind,key))deletion.run(kind,key);}),
          prune:onlyActive(now=>expiry.run(now))
        });
        try{
          let result;
          // Use only awaited tx operations here; do not await external work while the write lock is held.
          try{result=await run(tx);}finally{active=false;}
          db.exec('COMMIT');
          return result;
        }catch(error){db.exec('ROLLBACK');throw error;}
      });
    },
    close(){
      if(pending)throw Error('Cannot close store with pending operations');
      db.close();
    }
  });
}
