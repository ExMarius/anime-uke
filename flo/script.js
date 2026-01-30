const video = document.getElementById("video");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const exerciseEl = document.getElementById("exercise");
const toggleBtn = document.getElementById("toggle");

let count = 0;
let state = "UP";
let exercise = "pushup";
let calibrated = false;
let lastRep = 0;

const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

// adaptive thresholds (calibrate)
let BASE = { down: 0, up: 0 };

function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  return Math.acos(dot / (Math.hypot(ab.x,ab.y)*Math.hypot(cb.x,cb.y))) * 180 / Math.PI;
}

function avg(arr) {
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}

// EMA smoothing
let ema = null;
function smooth(v, alpha = 0.2) {
  ema = ema === null ? v : alpha*v + (1-alpha)*ema;
  return ema;
}

function valid(p) {
  return p && p.score > 0.6;
}

function plank(s, h, a) {
  return Math.abs(s.y-h.y)<50 && Math.abs(h.y-a.y)<50;
}

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: isMobile?"environment":"user" }
  });
  video.srcObject = stream;
  return new Promise(r => video.onloadedmetadata = r);
}

async function main() {
  await setupCamera();

  const detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.THUNDER }
  );

  let samples = [];

  async function loop() {
    const poses = await detector.estimatePoses(video);
    if (!poses.length) return requestAnimationFrame(loop);

    const kp = poses[0].keypoints;
    const g = n => kp.find(p=>p.name===n && valid(p));

    const rs=g("right_shoulder"), re=g("right_elbow"), rw=g("right_wrist");
    const rh=g("right_hip"), rk=g("right_knee"), ra=g("right_ankle");

    if (!rs||!re||!rw||!rh||!rk||!ra) return requestAnimationFrame(loop);

    // ── CALIBRARE ──
    if (!calibrated) {
      let a = exercise==="pushup"
        ? angle(rs,re,rw)
        : angle(rh,rk,ra);
      samples.push(a);
      statusEl.textContent = "Calibrare... stai SUS";
      if (samples.length > 30) {
        const up = avg(samples);
        BASE.up = up - 10;
        BASE.down = up - 60;
        calibrated = true;
        statusEl.textContent = "START";
      }
      return requestAnimationFrame(loop);
    }

    const now = Date.now();

    // ── PUSHUPS ──
    if (exercise==="pushup" && plank(rs,rh,ra)) {
      let a = smooth(angle(rs,re,rw));

      if (a < BASE.down && state==="UP") state="DOWN";
      if (a > BASE.up && state==="DOWN" && now-lastRep>700) {
        count++; countEl.textContent=count;
        state="UP"; lastRep=now;
      }
    }

    // ── SQUATS ──
    if (exercise==="squat") {
      let a = smooth(angle(rh,rk,ra));

      if (a < BASE.down && state==="UP") state="DOWN";
      if (a > BASE.up && state==="DOWN" && now-lastRep>700) {
        count++; countEl.textContent=count;
        state="UP"; lastRep=now;
      }
    }

    requestAnimationFrame(loop);
  }

  loop();
}

toggleBtn.onclick = () => {
  exercise = exercise==="pushup" ? "squat" : "pushup";
  exerciseEl.textContent = exercise==="pushup" ? "Flotări" : "Genuflexiuni";
  count=0; state="UP"; calibrated=false; samples=[];
  countEl.textContent=0;
};

main();
