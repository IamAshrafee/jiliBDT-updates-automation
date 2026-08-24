import { hashPassword } from '../apps/server/src/auth/password.js';

const password = process.argv[2];
if (!password) throw new Error('Usage: pnpm admin:password -- "your long password"');
process.stdout.write(`${await hashPassword(password)}\n`);
