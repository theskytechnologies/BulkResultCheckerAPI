cluster.task(async ({ page, data }) => {
  const { seatNumber } = data;

  // speed optimizations…
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image','stylesheet','font','media'].includes(req.resourceType())) req.abort();
    else req.continue();
  });
  await page.setCacheEnabled(true);
  await page.setViewport({ width: 800, height: 600 });

  // navigate & inputs…
  await page.goto('https://gseb.org/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.select('#drpInitChar', seatNumber.charAt(0));
  await page.evaluate(val => {
    const inp = document.querySelector('#SeatNo');
    inp.value = val;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, seatNumber.slice(1));

  // solve captcha…
  const captchaText = await page.$eval('#lblCaptcha', el => el.innerText.trim());
  const answer = solveCaptcha(captchaText);
  await page.evaluate(val => {
    const inp = document.querySelector('#txtCaptcha');
    inp.value = val;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, answer.toString());

  // submit + wait
  await Promise.all([
    page.click('input[name="go"]'),
    page.waitForSelector('table.maintbl', { timeout: 10000 })
  ]);

  // scrape
  const result = await page.evaluate(() => {
    // helper to split Label: Value
    const extract = label => {
      const cell = [...document.querySelectorAll('table.maintbl td')]
        .find(td => td.innerText.includes(label));
      return cell ? cell.innerText.split(':')[1].trim() : '';
    };

    const data = {
      seatNo:         extract('Seat No'),
      name:           extract('Name'),
      result:         extract('Result'),
      schoolIndex:    extract('School Index'),
      sidNo:          extract('S.I.D.'),
      percentileRank: extract('Percentile'),
      overallGrade:   extract('Grade'),
      boardMarks:     [],
      grandTotal:     ''
    };

    document.querySelectorAll('table.maintbl tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      // Subject rows now have 5 columns
      if (tds.length === 5 && /^\d+/.test(tds[0].innerText.trim())) {
        data.boardMarks.push({
          subjectName:   tds[0].innerText.trim(),
          externalMark:  tds[1].innerText.trim(),
          internalMark:  tds[2].innerText.trim(),
          totalOutOf100: tds[3].innerText.trim(),
          grade:         tds[4].innerText.trim(),
        });
      }
      // Grand Total row
      if (tds.length >= 2 && tds[0].innerText.includes('Grand Total')) {
        data.grandTotal = tds[1].innerText.trim();
      }
    });

    return data;
  });

  return result;
});