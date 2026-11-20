import type { Channel, Message, User } from "../types";

export const users: User[] = [
  "Alex Chen",
  "Maya Patel",
  "Noor Hassan",
  "Kai Moreno",
  "Sam Rivera",
  "Lin Park",
].map((full_name, i) => ({
  user_id: i + 1,
  full_name,
  email: `${full_name.split(" ")[0].toLowerCase()}@example.invalid`,
  is_active: true,
  is_bot: false,
  role: 400,
  timezone: "UTC",
}));
export const channels: Channel[] = [
  ["general", "Introductions, questions and plans."],
  ["type-theory", "Proofs, questions and small discoveries."],
  ["projects", "Things we are making."],
  ["reading-group", "Papers and reading notes."],
].map(([name, description], i) => ({
  stream_id: i + 1,
  name,
  description,
  color: "#8992e8",
  invite_only: false,
  is_muted: false,
}));

export function sampleMessages(): Message[] {
  const rows: [number, number, string, string][] = [
    [
      2,
      1,
      "Start here",
      "<p>Welcome to Proof Club! This is a fictional workspace for trying Zoomerlip.</p>",
    ],
    [
      2,
      1,
      "Start here",
      "<p>Pick a channel on the left, then open a topic underneath it. Each conversation gets its own thread.</p>",
    ],
    [
      3,
      1,
      "Start here",
      "<p>You can send a message or add a reaction here. Nobody else sees it; demo messages reset when you reload.</p>",
    ],
    [1, 1, "Start here", "<p>Found the themes. Already distracted.</p>"],
    [
      4,
      1,
      "Start here",
      "<p>The palette button at the bottom left is dangerously good at that.</p>",
    ],
    [
      5,
      1,
      "Weekend plans",
      "<p>Anyone bringing a project to the library on Saturday?</p>",
    ],
    [
      3,
      1,
      "Weekend plans",
      "<p>A parser that currently accepts nothing. Very secure.</p>",
    ],
    [
      2,
      2,
      "Induction on lists",
      "<p>I put together a small example for tomorrow’s proof clinic.</p>",
    ],
    [
      2,
      2,
      "Induction on lists",
      "<p>Reversing a list twice gives you the original list.</p><pre><code>theorem reverse_reverse (xs : List α) :\n    xs.reverse.reverse = xs := by\n  induction xs with\n  | nil =&gt; rfl\n  | cons x xs ih =&gt; simp [ih]</code></pre>",
    ],
    [
      3,
      2,
      "Induction on lists",
      "<p>Could we try the same proof without <code>simp</code>?</p>",
    ],
    [
      4,
      2,
      "Induction on lists",
      "<p>Yes. We would need a lemma about reversing an appended list first.</p>",
    ],
    [
      1,
      2,
      "Induction on lists",
      "<p>Two exercises, then: one using the library, one from the definitions.</p>",
    ],
    [
      2,
      2,
      "Proof clinic",
      "<p>Thursday at 16:00. Bring a proof that is stuck and we’ll work through it together.</p>",
    ],
    [
      5,
      3,
      "Tiny compiler",
      "<p>The compiler can finally add two numbers. Only took three evenings.</p>",
    ],
    [
      6,
      3,
      "Tiny compiler",
      "<p>Next milestone: subtracting the evenings back.</p>",
    ],
    [
      5,
      3,
      "Tiny compiler",
      "<pre><code>let answer = 19 + 23\nprint(answer) // 42</code></pre>",
    ],
    [
      4,
      3,
      "Notebook",
      "<p>I’m making a notebook that keeps the failed attempts alongside the final proof.</p>",
    ],
    [
      1,
      3,
      "Notebook",
      "<p>Please keep the attempt where the induction hypothesis got stronger by accident.</p>",
    ],
    [
      6,
      4,
      "Next paper",
      "<p>Shall we read about bidirectional type checking next?</p>",
    ],
    [
      3,
      4,
      "Next paper",
      "<p>Yes. I’ll bring a small implementation so we can trace the rules.</p>",
    ],
    [
      2,
      4,
      "Reading notes",
      "<p>Notes template:</p><ul><li>What problem is being solved?</li><li>One example by hand.</li><li>What still makes no sense?</li></ul>",
    ],
    [2, 0, "", "<p>Hi Alex! The proof clinic notes are in type-theory.</p>"],
    [1, 0, "", "<p>Thanks, I’ll bring the append example.</p>"],
    [3, 0, "", "<p>Want to compare parser errors later?</p>"],
  ];
  const now = Math.floor(Date.now() / 1000);
  return rows.map(([sender, stream, subject, content], i) => ({
    id: i + 101,
    sender_id: sender,
    sender_full_name: users[sender - 1].full_name,
    avatar_url: null,
    timestamp: now - (rows.length - i) * 120,
    content,
    rendered_content: content,
    type: stream ? "stream" : "private",
    ...(stream ? { stream_id: stream } : {}),
    subject,
    display_recipient: stream
      ? channels[stream - 1].name
      : [users[0], users[sender === 1 ? 1 : sender - 1]].map((u) => ({
          id: u.user_id,
          full_name: u.full_name,
          email: u.email,
        })),
    flags: ["read"],
    reactions:
      i === 3 || i === 13
        ? [
            {
              emoji_name: "tada",
              emoji_code: "1f389",
              reaction_type: "unicode_emoji",
              user_id: 2,
            },
          ]
        : [],
  }));
}
