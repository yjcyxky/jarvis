// Simple test to check if the extension loads without errors
const path = require('path');

console.log('Testing Jarvis extension structure...');

// Check if required files exist
const fs = require('fs');
const requiredFiles = [
  'package.json',
  'tsconfig.json',
  'webpack.config.js',
  'src/extension.ts',
  'src/types/index.ts',
  'src/executors/claudeCodeExecutor.ts',
  'src/executors/agentManager.ts',
  'src/executors/todoManager.ts',
  'src/providers/agentTreeProvider.ts',
  'src/providers/todoTreeProvider.ts',
  'src/providers/statisticsProvider.ts'
];

let allFilesExist = true;
requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✓ ${file}`);
  } else {
    console.log(`✗ ${file} - MISSING`);
    allFilesExist = false;
  }
});

if (allFilesExist) {
  console.log('\n✅ All required files exist');
} else {
  console.log('\n❌ Some files are missing');
}

// Check if .jarvis directory structure exists
const jarvisDirs = [
  '.jarvis',
  '.jarvis/agents',
  '.jarvis/agent-logs',
  '.jarvis/todos',
  '.jarvis/todo-logs'
];

console.log('\nChecking .jarvis directory structure:');
jarvisDirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    console.log(`✓ ${dir}`);
  } else {
    console.log(`✗ ${dir} - MISSING`);
  }
});

console.log('\n📦 Package.json verification:');
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  console.log(`  Name: ${pkg.name}`);
  console.log(`  Version: ${pkg.version}`);
  console.log(`  Main: ${pkg.main}`);
  console.log(`  Engine: VSCode ${pkg.engines.vscode}`);
} catch (error) {
  console.error('  Error reading package.json:', error.message);
}