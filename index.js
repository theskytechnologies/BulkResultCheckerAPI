const express = require('express');
const { Cluster } = require('puppeteer-cluster');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const defaultData = {
  seatNo: "",
  name: "",
  percentileRank: "",
  overallGrade: "",
  result: "",
  schoolIndex: "",
  sidNo: "",
  boardMarks: [],
  grandTotal: ""
};

function solveCaptcha(captchaText) {
  const match = captchaText.match(/(\d+)\s*\+\s*(\d+)/);
  return match ? parseInt(match[1], 10) + parseInt(match[2], 10) : 0;
}

let cluster;
async function initCluster() {
  if (cluster) return;
  cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: 2,
    puppeteerOptions: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    timeout: 30000
  });

  cluster.on('taskerror', (err, data) => {
    console.error(`Task error for ${JSON.stringify(data)}: ${err.message}`);
  });

  cluster.task(async ({ page, data }) => {
    const { seatNumber } = data;

    // speed optimizations
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image','stylesheet','font','media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    await page.setCacheEnabled(true);
    await page.setViewport({ width: 800, height: 600 });

    // navigate & inputs
    await page.goto('https://gseb.org/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const initialChar = seatNumber.charAt(0);
    await page.select('#drpInitChar', initialChar);
    await page.evaluate(val => {
      const inp = document.querySelector('#SeatNo');
      inp.value = val;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, seatNumber.slice(1));

    // captcha
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
      const getText = (sel, prefix = "") => {
        const el = document.querySelector(sel);
        return el ? el.innerText.replace(prefix, "").trim() : "";
      };

      const data = {
        seatNo: getText("tr.background1:nth-child(1) span.colum-left", "Seat No:"),
        name:   getText("tr.background1:nth-child(1) span.colum-left + span.colum-left", "Name:"),
        percentileRank: getText("tr.background1:nth-child(2) span.colum-left", "Percentile:"),
        overallGrade:   getText("tr.background1:nth-child(2) span.colum-right", "Grade:"),
        result:         getText("tr.background1:nth-child(3) span.colum-left", "Result:"),
        schoolIndex:    getText("tr.background1:nth-child(3) span.colum-left + span.colum-left", "School Index:"),
        sidNo:          getText("tr.background1:nth-child(4) span.colum-left", "SID:"),
        boardMarks: [],
        grandTotal: ""
      };

      // subject rows
      document.querySelectorAll("table.maintbl tr:not(.background1)").forEach(row => {
        const spans = row.querySelectorAll("span");
        if (spans.length === 4 && /^\d{3}/.test(spans[0].innerText.trim())) {
          data.boardMarks.push({
            subjectName:   spans[0].innerText.trim(),
            totalMarks:    spans[1].innerText.trim(),
            marksObtained: spans[2].innerText.trim(),
            grade:         spans[3].innerText.trim()
          });
        }
      });

      // grand total row
    //   const totalRow = [...document.querySelectorAll("table.maintbl tr.background1")].find(tr =>
    //     tr.innerText.includes("Total Marks") && /\d+\s+\d+/.test(tr.innerText)
    //   );
    //   if (totalRow) {
    //     const match = totalRow.innerText.match(/Total Marks\s+(\d+)\s+(\d+)/);
    //     data.grandTotal = match ? `${match[2]}/${match[1]}` : "";
    //   }

    // grand total row
    const totalRow = [...document.querySelectorAll("table.maintbl tr.background1")].find(tr =>
      tr.innerText.includes("Total Marks") && /\d+\s+\d+/.test(tr.innerText)
    );
    if (totalRow) {
      const match = totalRow.innerText.match(/Total Marks\s+(\d+)\s+(\d+)/);
      data.grandTotal = match ? `${match[2]}/${match[1]}` : "";
    }
    // grand total: pick the <td class="textcolor"> in the last tr.background1
    const grandTd = document.querySelector("table.maintbl tr.background1 td.textcolor");
    if (grandTd) {
      const spans = grandTd.querySelectorAll("span");
      // spans[1] => <b>700</b>, spans[2] => <b>438</b>
      data.grandTotal = {
        outOf: spans[1]?.innerText.trim() || "",
        obtained: spans[2]?.innerText.trim() || ""
      };
    }
    
      return data;
    });

    return result;
  });
}

async function getResult(seatNumber) {
  await initCluster();
  return cluster.execute({ seatNumber });
}

app.get('/get-result', async (req, res) => {
  const seatNumber = req.query.seatNo;
  if (!seatNumber) {
    return res.status(400).json({ error: 'Missing query param: ?seatNumber=' });
  }

  try {
    const data = await getResult(seatNumber);
    res.json(data || defaultData);
  } catch (err) {
    console.error(err);
    res.json(defaultData);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
