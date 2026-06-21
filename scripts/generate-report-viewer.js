'use strict';

const path = require('node:path');
const { writeReportViewer } = require('../src/core/report-viewer');

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const result = writeReportViewer({ projectRoot });
  console.log(`PASS report viewer: ${result.outputPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
