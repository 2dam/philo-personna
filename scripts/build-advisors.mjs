import { writeFile } from "node:fs/promises";

const sourceUrl = "https://api.openml.org/data/v1/download/22102528/Pantheon-Project-Historical-Popularity-Index.arff";
const response = await fetch(sourceUrl, {
  headers: { "user-agent": "Mindset1000/1.0 (advisor catalog builder)" },
});
if (!response.ok) throw new Error(`Pantheon download failed: ${response.status}`);
const source = await response.text();

function parseArffRow(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "'") {
      if (quoted && line[i + 1] === "'") {
        value += "'";
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

const categoryMap = {
  Humanities: "철학·인문",
  Institutions: "리더십·사회",
  Arts: "문학·예술",
  "Science  Technology": "과학·기술",
  Business: "경영·경제",
  Sports: "스포츠·수행",
  Exploration: "탐험·도전",
};
const occupationKo = {
  Philosopher: "철학자", Writer: "작가", Politician: "정치 지도자", Inventor: "발명가",
  Mathematician: "수학자", Physicist: "물리학자", Composer: "작곡가", Painter: "화가",
  Scientist: "과학자", Psychologist: "심리학자", Economist: "경제학자", Historian: "역사가",
  Entrepreneur: "기업가", Actor: "배우", Director: "감독", Explorer: "탐험가",
  "Military Personnel": "군사 지도자", "Religious Figure": "종교 사상가",
};
const lines = source.slice(source.indexOf("@DATA") + 5).split(/\r?\n/).filter(Boolean);
const seen = new Set();
const records = [];

for (const line of lines) {
  const columns = parseArffRow(line);
  if (columns.length < 17) continue;
  const [articleId, name, , birthYear, , , country, , , , occupation, industry, domain, languages, , , hpi] = columns;
  if (!name || seen.has(name)) continue;
  seen.add(name);
  const role = occupationKo[occupation] || occupation;
  const countryText = country && country !== "?" && country !== "Unknown" ? country : "세계";
  const era = Number(birthYear) < 0 ? `기원전 ${Math.abs(Number(birthYear))}년경` : `${birthYear}년 출생`;
  records.push({
    id: records.length + 1,
    articleId: Number(articleId),
    name,
    category: categoryMap[domain] || domain || "역사·사회",
    occupation: role,
    industry,
    birthYear: Number(birthYear),
    country: countryText,
    intro: `${countryText}의 ${role}로, ${industry} 분야에 세계적인 발자취를 남겼습니다. ${era} 인물의 관점에서 현재의 선택을 함께 살펴봅니다.`,
    articleLanguages: Number(languages),
    historicalPopularityIndex: Number(hpi),
    sourceUrl: `https://en.wikipedia.org/?curid=${articleId}`,
  });
  if (records.length === 1000) break;
}

if (records.length !== 1000) throw new Error(`Expected 1000 unique profiles, received ${records.length}`);
await writeFile(
  new URL("../public/advisors-1000.json", import.meta.url),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "Pantheon 1.0 / OpenML",
    sourceUrl,
    count: records.length,
    records,
  }),
  "utf8",
);
console.log(`Wrote ${records.length} unique advisor profiles.`);

