const dns = require('dns');
console.log('Default result order:', dns.getDefaultResultOrder());

// resolveAll (uses system resolver like PowerShell)
dns.resolveAll('api.bgm.tv', (err, addresses) => {
  if (err) { console.log('resolveAll error:', err.message); return; }
  console.log('resolveAll (A records):');
  addresses.forEach(a => console.log('  ' + a.address + ' (ttl: ' + a.ttl + ')'));
});

// lookup (what http-proxy actually uses)
dns.lookup('api.bgm.tv', { all: true }, (err, addresses) => {
  if (err) { console.log('lookup error:', err.message); return; }
  console.log('lookup (all addresses):');
  addresses.forEach(a => console.log('  ' + a.address + ' (family: ' + a.family + ')'));
});

// Single lookup (default behavior)
dns.lookup('api.bgm.tv', (err, address, family) => {
  if (err) { console.log('single lookup error:', err.message); return; }
  console.log('single lookup: ' + address + ' (family: ' + family + ')');
});
