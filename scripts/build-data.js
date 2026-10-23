// Converts the plain-text books in /book into the JSON the reader loads:
//   public/data/toc.json        table of contents with character offsets
//   public/data/ch/<n>.json     one file per chapter (array of paragraphs)
// Run with `npm run build-data` after editing anything in /book.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bookDir = path.join(root, 'book');
const outDir = path.join(root, 'public', 'data');
const chDir = path.join(outDir, 'ch');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(chDir, { recursive: true });

const files = fs.readdirSync(bookDir).filter((f) => f.endsWith('.txt')).sort();
const toc = { title: '전쟁과 평화', author: '레프 톨스토이', books: [], totalChars: 0 };
let id = 0;

for (const file of files) {
  const lines = fs.readFileSync(path.join(bookDir, file), 'utf8').replace(/\r/g, '').split('\n');
  const bookTitle = lines.shift().trim();
  const book = { title: bookTitle, chapters: [] };
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^제\s*\d+\s*장$/.test(line)) {
      current = { title: line, paras: [] };
      book.chapters.push(current);
    } else {
      if (!current) {
        current = { title: '', paras: [] };
        book.chapters.push(current);
      }
      current.paras.push(line);
    }
  }

  book.chapters = book.chapters.map((c, i) => {
    const chars = c.paras.reduce((n, p) => n + p.length, 0);
    const entry = { id, title: c.title, start: toc.totalChars, chars };
    fs.writeFileSync(
      path.join(chDir, `${id}.json`),
      JSON.stringify({ id, book: bookTitle, bookStart: i === 0, title: c.title, paras: c.paras })
    );
    toc.totalChars += chars;
    id++;
    return entry;
  });
  toc.books.push(book);
}

toc.chapterCount = id;
fs.writeFileSync(path.join(outDir, 'toc.json'), JSON.stringify(toc));
console.log(`Built ${toc.books.length} books, ${id} chapters, ${toc.totalChars.toLocaleString()} characters.`);
