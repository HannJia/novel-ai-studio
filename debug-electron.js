console.log('process.type:', process.type);
console.log('__dirname:', __dirname);
console.log('require.resolve("electron"):', require.resolve('electron'));

try {
  const electron = require('electron');
  console.log('typeof electron:', typeof electron);
  console.log('electron:', electron);
} catch (e) {
  console.log('Error:', e.message);
}
