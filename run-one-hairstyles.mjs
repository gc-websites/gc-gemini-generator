import { generateAndPostHairStyles } from './functionsHairStyles.js';
try {
  const posted = await generateAndPostHairStyles();
  console.log('RESULT documentId:', posted?.data?.documentId || '(none)');
} catch (e) { console.error('FAILED:', e.message); }
