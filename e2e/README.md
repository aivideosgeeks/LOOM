# End-to-end pass

Drives the running app in Chrome, asserts every screen and control, and captures a
screenshot of each state. The screenshots feed the illustrated handbook; the JSON
result file feeds the test report.

```bash
npm run dev                 # app must be running on :3000 and :4000
npm install --prefix e2e    # puppeteer-core only, uses your installed Chrome
node e2e/ui-pass.cjs
```

Outputs `e2e/shots/` and `e2e/ui-results.json`.

Then, to rebuild the documents:

```bash
python e2e/compress-shots.py       # shrink screenshots and inline them
node docs/build-illustrated.cjs    # illustrated handbook (HTML)
node docs/build-illustrated-pdf.cjs
node docs/build-test-report.cjs    # test report (HTML)
node docs/build-test-report-pdf.cjs
```
