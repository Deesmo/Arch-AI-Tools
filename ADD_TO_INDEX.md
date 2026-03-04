## One-line change needed in api/src/index.ts

Find this block near the top where express middleware is set up (after `const app = express();`):

```typescript
import path from 'path';

// Add BEFORE your root GET route or any routes:
app.use(express.static(path.join(__dirname, '../public')));
```

Then find the existing root GET '/' route that returns JSON and REMOVE it 
(or move it to GET '/api' so the HTML landing page takes over the root).

The static middleware will serve api/public/index.html at GET /.
