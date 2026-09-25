import "dotenv/config";
import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import OpenAI, { toFile } from "openai";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY חסר. הוסף אותו לקובץ .env");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const allowedMethods = [
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword"
    ]);

    const extension = file.originalname.toLowerCase().split(".").pop();
    const allowedExtensions = new Set(["pdf", "txt", "md", "docx", "doc"]);

    if (allowed.has(file.mimetype) || allowedExtensions.has(extension)) {
      cb(null, true);
    } else {
      cb(new Error("סוג הקובץ אינו נתמך. העלה PDF, Word או TXT."));
    }
  }
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "בוצעו יותר מדי בקשות. נסה שוב בעוד כמה דקות."
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

function cleanString(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function validateRequest(body) {
  const topic = cleanString(body.topic, 200);
  const duration = Number(body.duration);
  const methods = Array.isArray(body.methods)
    ? body.methods.map(String)
    : [];
  const referenceText = cleanString(body.referenceText, 30000);

  if (!topic) {
    throw new Error("חסר נושא פעולה.");
  }

  if (!Number.isInteger(duration) || duration < 5 || duration > 600) {
    throw new Error("הזמן חייב להיות מספר שלם בין 5 ל-600 דקות.");
  }

  const invalidMethods = methods.filter((m) => !allowedMethods.includes(m));
  if (invalidMethods.length) {
    throw new Error("נשלחה מתודה שאינה מאושרת.");
  }

  if (!methods.length) {
    throw new Error("בחר לפחות מתודה אחת.");
  }

  if (!referenceText && !body.hasFile) {
    throw new Error("יש להדביק מודל לחיקוי או להעלות קובץ.");
  }

  return { topic, duration, methods, referenceText };
}

function buildInstructions({ topic, duration, methods }) {
  return `
אתה מחולל פעולות לתנועת הצופים עבור מדריכים.

המשימה:
צור פעולה חדשה בנושא "${topic}" באורך כולל של ${duration} דקות.

המתודות המאושרות היחידות:
${methods.map((m) => `- ${m}`).join("\n")}

חוקי ברזל:
1. אסור להשתמש במתודה שאינה מופיעה ברשימה.
2. לכל חלק בפעולה חייב להיות שדה "method" עם שם מדויק של מתודה מאושרת.
3. לכל חלק חייב להיות שדה "minutes" במספר שלם.
4. סכום minutes של כל החלקים חייב להיות בדיוק ${duration}.
5. הפעולה חייבת להיות חדשה. אין להעתיק ניסוחים מהמודל.
6. למד מהמודל את המבנה, הסגנון, רמת הפירוט וצורת הניסוח, אך כתוב תוכן חדש.
7. המבנה צריך לכלול פתיחה, סבב שמות, חלקים ממוספרים, שאלות פתוחות או דיון כאשר הדבר מתאים, וסגירה עם מסר המדריך.
8. סבב השמות הוא חלק מהפעולה ולכן יש לו זמן.
9. אל תמציא מתודות חדשות.
10. אם יש סתירה בין המודל לבין ההנחיות כאן, ההנחיות כאן גוברות.
11. לפני החזרת התשובה, בדוק חשבונית שסכום הזמנים שווה בדיוק ל-${duration}.
12. החזר JSON בלבד בהתאם לסכמה שניתנה. אין Markdown.

סגנון:
- עברית טבעית של מדריך צופים.
- הוראות פרקטיות וברורות.
- שאלות שאפשר לשאול חניכים בפועל.
- פירוט מספיק למדריך כדי להעביר את הפעולה בלי לנחש מה לעשות.
`;
}

const actionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    topic: { type: "string" },
    totalMinutes: { type: "integer" },
    opening: { type: "string" },
    nameRound: {
      type: "object",
      additionalProperties: false,
      properties: {
        method: { type: "string", enum: allowedMethods },
        minutes: { type: "integer" },
        instructions: { type: "string" }
      },
      required: ["method", "minutes", "instructions"]
    },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          number: { type: "integer" },
          title: { type: "string" },
          method: { type: "string", enum: allowedMethods },
          minutes: { type: "integer" },
          instructions: { type: "string" },
          questions: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: [
          "number",
          "title",
          "method",
          "minutes",
          "instructions",
          "questions"
        ]
      }
    },
    closing: {
      type: "object",
      additionalProperties: false,
      properties: {
        method: { type: "string", enum: allowedMethods },
        minutes: { type: "integer" },
        instructions: { type: "string" },
        leaderMessage: { type: "string" }
      },
      required: ["method", "minutes", "instructions", "leaderMessage"]
    }
  },
  required: [
    "title",
    "topic",
    "totalMinutes",
    "opening",
    "nameRound",
    "parts",
    "closing"
  ]
};

function validateGeneratedAction(action, requested) {
  if (!action || typeof action !== "object") {
    throw new Error("המודל החזיר מבנה פעולה לא תקין.");
  }

  const selected = new Set(requested.methods);

  if (action.totalMinutes !== requested.duration) {
    throw new Error("בדיקת זמן נכשלה: הזמן הכולל אינו תואם לבקשה.");
  }

  const allSegments = [
    action.nameRound,
    ...(Array.isArray(action.parts) ? action.parts : []),
    action.closing
  ];

  if (!Array.isArray(action.parts) || action.parts.length === 0) {
    throw new Error("בדיקת מבנה נכשלה: חסרים חלקים.");
  }

  let total = 0;

  for (const segment of allSegments) {
    if (!segment || !Number.isInteger(segment.minutes) || segment.minutes <= 0) {
      throw new Error("בדיקת זמן נכשלה: נמצא חלק ללא זמן תקין.");
    }

    if (!selected.has(segment.method)) {
      throw new Error(`בדיקת מתודות נכשלה: ${segment.method} אינה מאושרת.`);
    }

    total += segment.minutes;
  }

  if (total !== requested.duration) {
    throw new Error(
      `בדיקת זמן נכשלה: סכום החלקים הוא ${total} במקום ${requested.duration}.`
    );
  }

  const numbers = action.parts.map((p) => p.number);
  const expected = action.parts.map((_p, i) => i + 1);

  if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
    throw new Error("בדיקת מבנה נכשלה: מספור החלקים אינו רציף.");
  }

  return action;
}

app.post("/api/generate", limiter, upload.single("referenceFile"), async (req, res) => {
  let uploadedFileId = null;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY אינו מוגדר בשרת."
      });
    }

    const body = {
      ...req.body,
      methods: typeof req.body.methods === "string"
        ? JSON.parse(req.body.methods)
        : req.body.methods,
      hasFile: Boolean(req.file)
    };

    const requested = validateRequest(body);

    const content = [
      {
        type: "input_text",
        text: `
פרטי הפעולה:
נושא: ${requested.topic}
זמן כולל: ${requested.duration} דקות
מתודות מאושרות:
${requested.methods.join(", ")}

מודל טקסטואלי שהודבק:
${requested.referenceText || "לא הודבק טקסט. יש להתייחס לקובץ המצורף כמודל לחיקוי."}
`
      }
    ];

    if (req.file) {
      const uploaded = await openai.files.create({
        file: await toFile(
          req.file.buffer,
          req.file.originalname,
          { type: req.file.mimetype }
        ),
        purpose: "user_data"
      });

      uploadedFileId = uploaded.id;

      content.push({
        type: "input_file",
        file_id: uploaded.id
      });
    }

    const response = await openai.responses.create({
      model: MODEL,
      instructions: buildInstructions(requested),
      input: [
        {
          role: "user",
          content
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "scout_action",
          strict: true,
          schema: actionSchema
        }
      }
    });

    const raw = response.output_text;
    if (!raw) {
      throw new Error("לא התקבלה תשובה מהמודל.");
    }

    const action = validateGeneratedAction(
      JSON.parse(raw),
      requested
    );

    res.json({
      action
    });
  } catch (error) {
    console.error(error);

    res.status(400).json({
      error: error?.message || "אירעה שגיאה ביצירת הפעולה."
    });
  } finally {
    if (uploadedFileId) {
      try {
        await openai.files.delete(uploadedFileId);
      } catch {
        // אין צורך להפיל את הבקשה אם מחיקת הקובץ נכשלה.
      }
    }
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: "העלאת הקובץ נכשלה. ודא שהקובץ קטן מ-10MB."
    });
  }

  return res.status(400).json({
    error: error.message || "אירעה שגיאה."
  });
});

app.listen(PORT, () => {
  console.log(`Scout Action Generator running on http://localhost:${PORT}`);
});
