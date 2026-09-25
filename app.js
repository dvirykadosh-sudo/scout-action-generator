const METHODS = [
  "הבעה יצירתית",
  "ייצוג",
  "עשייה",
  "משחק תחרות",
  "שיתוף",
  "דיון בשאלה",
  "חשיבה משותפת",
  "השראה",
  "פירוק",
  "הסבר",
  "התבוננות",
  "משחק הדמייה"
];

const $ = (id) => document.getElementById(id);

const methodsEl = $("methods");
const fileInput = $("referenceFile");
const fileName = $("fileName");
const generateBtn = $("generate");
const loading = $("loading");
const errorEl = $("error");
const resultPanel = $("resultPanel");
const resultEl = $("result");

function renderMethods() {
  methodsEl.innerHTML = METHODS.map((method, i) => `
    <label class="method" data-index="${i}">
      <input type="checkbox" value="${escapeHtml(method)}">
      <span>${escapeHtml(method)}</span>
    </label>
  `).join("");

  methodsEl.querySelectorAll(".method").forEach((label) => {
    label.addEventListener("click", () => {
      const checkbox = label.querySelector("input");
      setTimeout(() => label.classList.toggle("selected", checkbox.checked), 0);
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectedMethods() {
  return [...methodsEl.querySelectorAll("input:checked")].map((x) => x.value);
}

function setAll(value) {
  methodsEl.querySelectorAll("input").forEach((input) => {
    input.checked = value;
    input.closest(".method").classList.toggle("selected", value);
  });
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function clearError() {
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

function setLoading(value) {
  generateBtn.disabled = value;
  loading.classList.toggle("hidden", !value);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileName.textContent = file ? `נבחר: ${file.name}` : "";
});

$("selectAll").addEventListener("click", () => setAll(true));
$("clearAll").addEventListener("click", () => setAll(false));

function renderAction(action) {
  const parts = action.parts.map((part) => {
    const questions = part.questions?.length
      ? `<div><strong>שאלות:</strong><ul class="questions">${part.questions.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>`
      : "";

    return `
      <article class="part">
        <h3>${part.number}. ${escapeHtml(part.title)}</h3>
        <div class="method-badge">מתודה: ${escapeHtml(part.method)} · ${part.minutes} דקות</div>
        <p><strong>מה עושים:</strong><br>${escapeHtml(part.instructions).replaceAll("\n", "<br>")}</p>
        ${questions}
      </article>
    `;
  }).join("");

  return `
    <h1 class="action-title">${escapeHtml(action.title)}</h1>

    <div class="meta">
      <div class="meta-box"><strong>נושא:</strong><br>${escapeHtml(action.topic)}</div>
      <div class="meta-box"><strong>זמן כולל:</strong><br>${action.totalMinutes} דקות</div>
    </div>

    <div class="part">
      <h3>פתיחה</h3>
      <p>${escapeHtml(action.opening).replaceAll("\n", "<br>")}</p>
    </div>

    <div class="part">
      <h3>סבב שמות</h3>
      <div class="method-badge">מתודה: ${escapeHtml(action.nameRound.method)} · ${action.nameRound.minutes} דקות</div>
      <p>${escapeHtml(action.nameRound.instructions).replaceAll("\n", "<br>")}</p>
    </div>

    ${parts}

    <div class="part">
      <h3>סגירה</h3>
      <div class="method-badge">מתודה: ${escapeHtml(action.closing.method)} · ${action.closing.minutes} דקות</div>
      <p>${escapeHtml(action.closing.instructions).replaceAll("\n", "<br>")}</p>
      <p><strong>מסר המדריך:</strong><br>${escapeHtml(action.closing.leaderMessage).replaceAll("\n", "<br>")}</p>
    </div>
  `;
}

generateBtn.addEventListener("click", async () => {
  clearError();

  const topic = $("topic").value.trim();
  const duration = Number($("duration").value);
  const referenceText = $("referenceText").value.trim();
  const methods = selectedMethods();
  const file = fileInput.files[0];

  if (!topic) return showError("הזן נושא לפעולה.");
  if (!Number.isInteger(duration) || duration < 5 || duration > 600) {
    return showError("הזמן צריך להיות מספר שלם בין 5 ל-600 דקות.");
  }
  if (!methods.length) return showError("בחר לפחות מתודה אחת.");
  if (!file && !referenceText) {
    return showError("העלה מודל לחיקוי או הדבק טקסט.");
  }

  const form = new FormData();
  form.append("topic", topic);
  form.append("duration", String(duration));
  form.append("methods", JSON.stringify(methods));
  form.append("referenceText", referenceText);

  if (file) form.append("referenceFile", file);

  setLoading(true);
  resultPanel.classList.add("hidden");

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      body: form
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "יצירת הפעולה נכשלה.");
    }

    resultEl.innerHTML = renderAction(data.action);
    resultPanel.classList.remove("hidden");
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
});

$("pdf").addEventListener("click", async () => {
  const topic = $("topic").value.trim() || "פעולת צופים";

  if (!window.html2pdf) {
    return showError("ספריית PDF עדיין נטענת. נסה שוב בעוד רגע.");
  }

  await html2pdf()
    .set({
      margin: 10,
      filename: `${topic}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    })
    .from(resultEl)
    .save();
});

$("word").addEventListener("click", async () => {
  const topic = $("topic").value.trim() || "פעולת צופים";

  if (!window.docx) {
    return showError("ספריית Word עדיין נטענת. נסה שוב בעוד רגע.");
  }

  const { Document, Packer, Paragraph, HeadingLevel, AlignmentType } = window.docx;

  const paragraphs = [];

  resultEl.innerText.split("\n").forEach((line) => {
    const text = line.trim();
    if (!text) return;

    const heading =
      text === "פתיחה" ||
      text === "סגירה" ||
      /^\d+\./.test(text)
        ? HeadingLevel.HEADING_2
        : undefined;

    paragraphs.push(new Paragraph({
      text,
      heading,
      alignment: AlignmentType.RIGHT,
      bidirectional: true,
      spacing: { after: 180 }
    }));
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: "מחולל פעולות דביר קדוש",
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.RIGHT,
          bidirectional: true
        }),
        ...paragraphs
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${topic}.docx`;
  a.click();
  URL.revokeObjectURL(url);
});

renderMethods();
