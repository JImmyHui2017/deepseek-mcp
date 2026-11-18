import { createKeyProvider, keyStatus } from '../src/config.mjs';

console.log(JSON.stringify(await keyStatus(createKeyProvider()), null, 2));
