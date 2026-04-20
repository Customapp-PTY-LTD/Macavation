const fs = require('fs');
const raw = fs.readFileSync(__dirname + '/s20_args.json', 'utf8');
const width = 4000;
const lines = [];
for (let i = 0; i < raw.length; i += width) {
  lines.push('     ' + (lines.length + 1) + '|' + raw.slice(i, i + width));
}
const wrapped = lines.join('\n');
const unwrapped = wrapped
  .split('\n')
  .map((l) => l.replace(/^\s*\d+\|/, ''))
  .join('');
console.log('eq', unwrapped === raw);
