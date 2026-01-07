const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

// Health + root routes (prevents "Cannot GET /")
app.get("/", (req, res) => {
  res.status(200).send("Jaypardy backend is running ✅");
});

app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

/**
 * ===== Jaypardy V1.2 Server (Playable Round 1) =====
 * - Single `state` object
 * - Server is source of truth
 * - Clients render state
 * - Host emits events; server applies them and broadcasts state:update
 */

const TEAMS = [
  { id: "red", name: "Red", score: 0 },
  { id: "blue", name: "Blue", score: 0 },
  { id: "green", name: "Green", score: 0 },
  { id: "yellow", name: "Yellow", score: 0 },
  { id: "purple", name: "Purple", score: 0 },
  { id: "orange", name: "Orange", score: 0 },
];

const ROUND1_VALUES = [100, 200, 300, 400, 500];

// Question bank
const ROUND1_BANK = [
  {
    category: "90s Disney Princess",
    clues: [
      { q: "She has a tiger named Rajah.", a: "Who is Jasmine?" },
      { q: "This princess’s dad is Chief of the Powhatan tribe.", a: "Who is Pocahontas?" },
      { q: "She trades her voice for legs.", a: "Who is Ariel?" },
      { q: "She’s cursed to sleep after touching a spinning wheel.", a: "Who is Aurora?" },
      { q: "She marries a beast who becomes a prince again.", a: "Who is Belle?" },
    ],
  },
  {
    category: "The Office (US)",
    clues: [
      { q: "The regional manager of Dunder Mifflin Scranton.", a: "Who is Michael Scott?" },
      { q: "The beet-farming assistant regional manager.", a: "Who is Dwight Schrute?" },
      { q: "Jim’s classic prank weapon against Dwight.", a: "What is Jell-O?" },
      { q: "The office HR rep.", a: "Who is Toby Flenderson?" },
      { q: "The chili guy.", a: "Who is Kevin Malone?" },
    ],
  },
  {
    category: "iCarly",
    clues: [
      { q: "Carly’s older brother.", a: "Who is Spencer Shay?" },
      { q: "The tech-savvy producer.", a: "Who is Freddie Benson?" },
      { q: "The web show name.", a: "What is iCarly?" },
      { q: "The doorman.", a: "Who is Lewbert?" },
      { q: "The character who yells his own name.", a: "Who is Gibby?" },
    ],
  },
  {
    category: "3rd Grade US Geography",
    clues: [
      { q: "The ocean on the West Coast.", a: "What is the Pacific Ocean?" },
      { q: "The U.S. capital.", a: "What is Washington, D.C.?" },
      { q: "State north of Oregon.", a: "What is Washington?" },
      { q: "Largest U.S. state.", a: "What is Alaska?" },
      { q: "River bordering Oregon & Washington.", a: "What is the Columbia River?" },
    ],
  },
  {
    category: "General Knowledge",
    clues: [
      { q: "The planet we live on.", a: "What is Earth?" },
      { q: "H2O.", a: "What is water?" },
      { q: "Opposite of hot.", a: "What is cold?" },
      { q: "A 3-sided shape.", a: "What is a triangle?" },
      { q: "The Sun is a…", a: "What is a star?" },
    ],
  },
    {
    category: "TikTok Gen Pop",
    clues: [
      { q: "The main page where TikTok shows recommended videos.", a: "What is the For You Page (FYP)?" },
      { q: "The TikTok feature used to respond side-by-side to another video.", a: "What is a Duet?" },
      { q: "The TikTok feature used to add your video after a clip.", a: "What is Stitch?" },
      { q: "The heart icon means you did this.", a: "What is like?" },
      { q: "A short repeating internet joke format.", a: "What is a meme?" },
    ],
  },

];

function pickRandom(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function buildRound1Board() {
  const cats = pickRandom(ROUND1_BANK, 6);

  const columns = cats.map((c, colIndex) => ({
    id: `c${colIndex}`,
    title: c.category,
    clues: pickRandom(c.clues, 5).map((cl, rowIndex) => ({
      id: `c${colIndex}r${rowIndex}`,
      value: ROUND1_VALUES[rowIndex],
      question: cl.q,
      answer: cl.a,
      used: false,
      isDD: false,
    })),
  }));

  const ddCol = Math.floor(Math.random() * columns.length);
  const ddRow = Math.floor(Math.random() * columns[ddCol].clues.length);
  columns[ddCol].clues[ddRow].isDD = true;

  return { round: 1, columns };
}

function freshState() {
  return {
    phase: "lobby",
    players: [],
    teams: TEAMS.map((t) => ({ ...t, score: 0 })),
    controlTeamId: null,
    board: null,
    currentClue: null,
    buzz: {
      locked: false,
      playerId: null,
      teamId: null,
      name: null,
      emoji: null,
      timestamp: null,
    },
  };
}

let state = freshState();

function emitState() {
  io.emit("state:update", state);
}

function resetBuzz() {
  state.buzz = {
    locked: false,
    playerId: null,
    teamId: null,
    name: null,
    emoji: null,
    timestamp: null,
  };
}

io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);
  socket.emit("state:update", state);

  socket.on("player:join", ({ name, emoji }) => {
    state.players = state.players.filter((p) => p.id !== socket.id);
    state.players.push({
      id: socket.id,
      name: (name || "").trim(),
      emoji: emoji || "😀",
      teamId: null,
    });
    emitState();
  });

  socket.on("host:assignTeam", ({ playerId, teamId }) => {
    const p = state.players.find((x) => x.id === playerId);
    if (p) p.teamId = teamId || null;
    emitState();
  });

  socket.on("host:startJaypardy", () => {
    state.board = buildRound1Board();
    state.phase = "board";
    state.currentClue = null;
    resetBuzz();
    emitState();
  });

  socket.on("host:selectClue", ({ colIndex, rowIndex }) => {
    const clue = state.board?.columns?.[colIndex]?.clues?.[rowIndex];
    if (!clue || clue.used) return;

    state.currentClue = { colIndex, rowIndex, ...clue };
    state.phase = "clue";
    resetBuzz();
    emitState();
  });

  socket.on("player:buzz", () => {
    if (state.phase !== "clue" || state.buzz.locked) return;
    const p = state.players.find((x) => x.id === socket.id);
    if (!p || !p.teamId) return;

    state.buzz = {
      locked: true,
      playerId: p.id,
      teamId: p.teamId,
      name: p.name,
      emoji: p.emoji,
      timestamp: Date.now(),
    };
    emitState();
  });

  socket.on("host:resetBuzz", () => {
    resetBuzz();
    emitState();
  });

  socket.on("host:mark", ({ result }) => {
    if (!state.currentClue) return;

    if (result === "correct" && state.buzz.teamId) {
      const t = state.teams.find((x) => x.id === state.buzz.teamId);
      if (t) t.score += state.currentClue.value;
      state.controlTeamId = state.buzz.teamId;
    }

    const clue =
      state.board?.columns?.[state.currentClue.colIndex]?.clues?.[
        state.currentClue.rowIndex
      ];
    if (clue) clue.used = true;

    state.currentClue = null;
    state.phase = "board";
    resetBuzz();
    emitState();
  });

  socket.on("host:resetGame", () => {
    const players = [...state.players];
    state = freshState();
    state.players = players;
    emitState();
  });

  socket.on("disconnect", () => {
    state.players = state.players.filter((p) => p.id !== socket.id);
    if (state.buzz.playerId === socket.id) resetBuzz();
    emitState();
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Jaypardy server running on port ${PORT}`)
);
