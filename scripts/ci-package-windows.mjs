import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';

const scrub=text=>String(text).replace(/https?:\/\/\S+/g,'[URL]').replace(/(?:token|password|authorization|secret|_authToken)\s*(?:=|:)\s*[^\s,]+/gi,'[redacted]');
const annotate=text=>process.stdout.write(`::error title=Windows installer diagnostic::${scrub(text).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A')}\n`);
process.on('uncaughtException',error=>{annotate(error.message);process.exitCode=1;});
process.on('unhandledRejection',error=>{annotate(error instanceof Error?error.message:error);process.exitCode=1;});

const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Run this helper with npm run ci:package:windows.');
const child=spawn(process.execPath,[npmCli,'run','package:windows'],{stdio:['ignore','pipe','pipe'],env:process.env});
let output='';
for(const [stream,destination] of [[child.stdout,process.stdout],[child.stderr,process.stderr]]){
  stream.on('data',chunk=>{destination.write(chunk);output=(output+chunk.toString()).slice(-2*1024*1024);});
}
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
if(code!==0){
  const diagnostic=output.split(/\r?\n/).filter(line=>/error|failed|failure|ENOENT|Assertion|actual:|expected:|\.mjs:\d+/i.test(line)).slice(-45).join('\n')
    .replace(/https?:\/\/\S+/g,'[URL]')
    .replace(/(?:token|password|authorization|secret|_authToken)\s*(?:=|:)\s*[^\s,]+/gi,'[redacted]')
    .replace(/```/g,"'''");
  annotate(diagnostic||'No diagnostic lines were captured.');
  if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`\n## Installer build diagnostic\n\nThe Windows packaging command failed. Selected error lines follow.\n\n\`\`\`text\n${diagnostic||'No diagnostic lines were captured.'}\n\`\`\`\n`);
}
process.exitCode=typeof code==='number'?code:1;
