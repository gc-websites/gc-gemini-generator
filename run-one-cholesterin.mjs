import { generateAndPostCholesterin } from './functionsCholesterin.js';
try {
  const posted = await generateAndPostCholesterin();
  console.log('RESULT documentId:', posted?.data?.documentId || '(none)');
} catch (e) {
  console.error('FAILED:', e.message);
}
