const fs = require('fs');
const path = require('path');

const distPath = path.join(process.cwd(), 'dist');

console.log('📦 Build artifacts:');

if (!fs.existsSync(distPath)) {
  console.log('  ⚠️  dist directory not found');
  process.exit(1);
}

const files = fs.readdirSync(distPath);

if (files.length === 0) {
  console.log('  ⚠️  No files in dist directory');
} else {
  files.forEach(file => {
    const filePath = path.join(distPath, file);
    const stats = fs.statSync(filePath);
    const size = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`  📄 ${file} (${size} MB)`);
  });
}

console.log(`\n✅ Total files: ${files.length}`);