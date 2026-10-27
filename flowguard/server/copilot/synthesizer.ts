import type { SearchResult } from './bm25.ts';

export interface ApplicantContext {
  institutionName: string;
  application: {
    referenceNo: string | null;
    status: string;
    categoryCode: string;
    subtype: string | null;
    submittedAt: string | null;
  } | null;
  deficiencies: Array<{
    referenceNo: string;
    targetLabel: string;
    category: string;
    explanation: string;
    correctiveAction: string;
    deadline: string | null;
    status: string;
  }>;
}

export interface SynthesisOutput {
  answer: string;
  citations: Array<{
    clause: string;
    page: number;
    title: string;
    excerpt: string;
  }>;
  suggestedFollowups: string[];
  actionLinks?: Array<{
    label: string;
    path: string;
  }>;
}

export function synthesizeCopilotResponse(
  query: string,
  searchResults: SearchResult[],
  appContext: ApplicantContext | null,
): SynthesisOutput {
  const qLower = query.toLowerCase();

  // Check if user asks about their application or deficiencies
  const isApplicationQuery =
    qLower.includes('my application') ||
    qLower.includes('my status') ||
    qLower.includes('my deficiency') ||
    qLower.includes('my deficiencies') ||
    qLower.includes('what should i do next') ||
    qLower.includes('what next') ||
    qLower.includes('why was i rejected') ||
    qLower.includes('why is my application') ||
    qLower.includes('pending documents');

  if (isApplicationQuery && appContext) {
    return synthesizeApplicationStatusResponse(query, appContext, searchResults);
  }

  // Fallback if no statutory match found
  if (!searchResults || searchResults.length === 0) {
    return {
      answer:
        "I could not find this in the AICTE Approval Process Handbook (2024–27).\n\n" +
        "Please check the clause number or try searching with official regulatory terms such as:\n" +
        "- **Faculty-Student Ratio (FSR)**: Annexure 5\n" +
        "- **Scrutiny Committee & Appeal**: Clause 1.8\n" +
        "- **Extension of Approval (EoA)**: Chapter II & Annexure 2\n" +
        "- **Land and Built-up Area norms**: Annexure 3\n" +
        "- **Penal Actions & Violations**: Chapter VII",
      citations: [],
      suggestedFollowups: [
        "What are the Faculty-Student Ratio (FSR) norms?",
        "What documents are required for EoA under Annexure 2?",
        "What is the procedure for Scrutiny and Appeal under Clause 1.8?",
      ],
    };
  }

  const asksDeadline =
    qLower.includes('deadline') ||
    qLower.includes('last date') ||
    qLower.includes('due date') ||
    qLower.includes('cutoff date') ||
    qLower.includes('when is the last');

  const citations = searchResults.map(r => ({
    clause: r.chunk.clause,
    page: r.chunk.page,
    title: r.chunk.title,
    excerpt: extractKeySentences(r.chunk.text, query, 3),
  }));

  let answer = `### AICTE Approval Process Handbook (2024–27)\n\n`;

  if (asksDeadline) {
    answer += `> **Statutory Notice on Deadlines**: The Approval Process Handbook prescribes statutory criteria, ratios, and evaluation frameworks, but specific calendar submission deadlines are published separately by AICTE through public notifications and the portal calendar for each cycle.\n\n`;
  }

  searchResults.forEach((r, idx) => {
    const chunk = r.chunk;
    const excerpt = extractKeySentences(chunk.text, query, 4);

    answer += `#### ${idx + 1}. ${chunk.clause}: ${chunk.title} *(Page ${chunk.page})*\n`;
    answer += `> "${excerpt}"\n\n`;
    answer += `*Source: ${chunk.chapter} — **[Clause ${chunk.clause}, p. ${chunk.page}]***\n\n`;
  });

  answer += `**Key Regulatory Requirements:**\n`;
  searchResults.forEach(r => {
    answer += `- **${r.chunk.clause} (${r.chunk.title})**: Governed under ${r.chunk.chapter} (Handbook p. ${r.chunk.page}).\n`;
  });

  const followups = generateFollowupQuestions(query, searchResults);

  return {
    answer,
    citations,
    suggestedFollowups: followups,
  };
}

function synthesizeApplicationStatusResponse(
  query: string,
  ctx: ApplicantContext,
  searchResults: SearchResult[],
): SynthesisOutput {
  const app = ctx.application;
  const defs = ctx.deficiencies || [];

  if (!app) {
    return {
      answer:
        `### Your Application Status\n\n` +
        `No active application was found for **${ctx.institutionName}**.\n\n` +
        `To submit a new application for Letter of Approval (LoA) or Extension of Approval (EoA), navigate to the **Applications** section and start a new application according to **Chapter I / Chapter II** of the Approval Process Handbook.`,
      citations: [],
      suggestedFollowups: [
        "What documents are required for Setting up a New Technical Institution?",
        "What documents are required for EoA under Annexure 2?",
      ],
      actionLinks: [{ label: "Start Application", path: "/applications/new" }],
    };
  }

  let answer = `### Application Overview: ${ctx.institutionName}\n\n`;
  answer += `- **Application Reference**: \`${app.referenceNo || 'Draft'}\`\n`;
  answer += `- **Current Stage**: **${formatStatus(app.status)}**\n`;
  answer += `- **Category**: ${app.categoryCode}${app.subtype ? ` (${app.subtype})` : ''}\n\n`;

  if (defs.length > 0) {
    answer += `#### Outstanding Deficiencies (${defs.length} Pending)\n\n`;
    defs.forEach((d, idx) => {
      answer += `**${idx + 1}. ${d.targetLabel}** (${d.category})\n`;
      answer += `- *Explanation*: ${d.explanation}\n`;
      answer += `- *Required Action*: ${d.correctiveAction}\n`;
      if (d.deadline) {
        answer += `- *Resolution Deadline*: **${d.deadline}**\n`;
      }
      answer += `\n`;
    });

    answer += `#### Statutory Guidance from Handbook\n`;
    answer += `Under **Clause 1.8(f) (p. 23–25)** and **Chapter VII** of the Approval Process Handbook, institutions marked with deficiencies during Scrutiny or EVC have the statutory right to present compliance documents before the Re-Scrutiny or Standing Hearing Committee (SHC).\n\n`;
    answer += `> *"Institutions that are issued a deficiency report may upload rectified compliance documents and appear before the Committee within the stipulated time window."* **[Clause 1.8(f), Page 25]**\n\n`;

    return {
      answer,
      citations: [
        {
          clause: 'Clause 1.8(f)',
          page: 25,
          title: 'Scrutiny Committee Deficiency & Compliance',
          excerpt: 'Institutions that are issued a deficiency report may upload rectified compliance documents and appear before the Committee.',
        },
      ],
      suggestedFollowups: [
        "How do I submit compliance for my deficiencies?",
        "What is the procedure before the Standing Hearing Committee (SHC)?",
        "What are the Land norms under Annexure 3?",
      ],
      actionLinks: [
        { label: "View Deficiencies Tab", path: "/deficiencies" },
        { label: "Respond to Notice", path: "/respond" },
      ],
    };
  }

  answer += `You currently have **no outstanding deficiencies**. Your application is actively progressing through the **${formatStatus(app.status)}** stage.\n\n`;
  answer += `Under AICTE norms, the next step involves verification by the designated Committee as outlined in **Annexure 16 (Structure of Various Committees, p. 192)**.`;

  return {
    answer,
    citations: [
      {
        clause: 'Annexure 16',
        page: 192,
        title: 'Structure of Various Committees',
        excerpt: 'Committees constituted by AICTE for Scrutiny, EVC, SHC, and SAC evaluations.',
      },
    ],
    suggestedFollowups: [
      "What are the inspection norms for Expert Visit Committee (EVC)?",
      "What is the procedure for Grant of Approval?",
    ],
    actionLinks: [{ label: "View Application Details", path: `/applications/${app.referenceNo || ''}` }],
  };
}

function extractKeySentences(text: string, query: string, maxSentences: number = 3): string {
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.?!])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  if (sentences.length <= maxSentences) {
    return sentences.join(' ');
  }

  const qTerms = query.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 2);

  const scored = sentences.map(s => {
    const sLower = s.toLowerCase();
    let matches = 0;
    for (const qt of qTerms) {
      if (sLower.includes(qt)) matches++;
    }
    return { sentence: s, matches };
  });

  scored.sort((a, b) => b.matches - a.matches);

  const top = scored.slice(0, maxSentences).map(s => s.sentence);
  return top.join(' ');
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function generateFollowupQuestions(query: string, results: SearchResult[]): string[] {
  const followups: string[] = [];
  const primary = results[0]?.chunk;

  if (primary) {
    if (primary.clause.startsWith('1.')) {
      followups.push("What are the land and infrastructure requirements for a new institution?");
      followups.push("What is the fee and TER charges for new application?");
    } else if (primary.clause.startsWith('2.')) {
      followups.push("What are the requirements for increasing intake or adding new courses?");
      followups.push("What documents are required under Annexure 2 for EoA?");
    } else if (primary.clause.includes('5') || primary.chapter.includes('Faculty')) {
      followups.push("What is the Cadre Ratio for Professor, Associate Professor, and Assistant Professor?");
      followups.push("What are the qualifications required for Principal / Director?");
    }
  }

  followups.push("What is the procedure if deficiencies are raised during Scrutiny?");
  followups.push("What are the penal actions for violation of AICTE norms?");

  return followups.slice(0, 3);
}
