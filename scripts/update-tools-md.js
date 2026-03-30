const fs = require('fs');
const path = require('path');

const files = [
  'C:/Users/Win10/.openclaw/workspace-prod/template/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/agents/拾尘/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/agents/映川/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/agents/晴岚/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/agents/砚池/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/13161292827/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/13269259038/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/13466318080/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/13661213616/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/13699145336/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/13800000001/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/13800000002/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/13800000003/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/15503329802/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/18600211699/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/18911182814/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/18911811658/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/admin/TOOLS.md',
  'C:/Users/Win10/.openclaw/workspace-prod/users/{username}/TOOLS.md',
];

const OLD_MARKER = '### 生成文件给用户下载（3步）';

const NEW_SECTION = `### 生成文件给用户下载（必须完成全部3步，不可省略）

**每次用 \`write\` 生成任何文件后，必须立即执行步骤2和3，这是强制要求。**

1. 用 \`write\` 写文件到用户文件目录（\`C:\\\\Users\\\\Win10\\\\.openclaw\\\\workspace-prod\\\\users\\\\{username}\\\\files\\\\\`）

2. 登记到文件 Tab（**必须执行，否则用户看不到文件**）：
\`\`\`powershell
$body = [System.Text.Encoding]::UTF8.GetBytes('{"name":"文件名","localPath":"完整路径","sender":"agentId","desc":"说明"}')
Invoke-RestMethod -Uri "http://127.0.0.1:18790/api/files" -Method POST -ContentType "application/json; charset=utf-8" -Body $body
\`\`\`
> 注意：\`-Body\` 必须用 \`[System.Text.Encoding]::UTF8.GetBytes(...)\` 包装，否则中文文件名会乱码。

3. 回复用户，告知文件已生成，下载链接：\`http://YOUR_SERVER_IP:29000/files/{username}/{filename}\`（filename 需 URL 编码中文）`;

// The old section ends right before "---" or next "##"
function replaceSection(content) {
  const startIdx = content.indexOf(OLD_MARKER);
  if (startIdx === -1) return null;

  // Find end of section: next line starting with "---" or "##" after the section
  const afterStart = content.slice(startIdx);
  const endMatch = afterStart.match(/\n(?=---|\n##)/);
  const endIdx = endMatch ? startIdx + endMatch.index : content.length;

  return content.slice(0, startIdx) + NEW_SECTION + content.slice(endIdx);
}

let updated = 0;
for (const f of files) {
  try {
    const content = fs.readFileSync(f, 'utf8');
    const result = replaceSection(content);
    if (result === null) {
      console.log('skip (no marker):', f);
    } else if (result === content) {
      console.log('skip (already up to date):', f);
    } else {
      fs.writeFileSync(f, result, 'utf8');
      console.log('updated:', f);
      updated++;
    }
  } catch(e) {
    console.log('err:', f, e.message);
  }
}
console.log('total updated:', updated);
