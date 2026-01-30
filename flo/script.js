const video = document.getElementById("video");
const countEl = document.getElementById("count");
const exerciseEl = document.getElementById("exercise");
const toggleBtn = document.getElementById("toggle");

let count = 0;
let state = "UP";
let exercise = "pushup"; // pushup | squat
let lastRepTime = 0;

const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

// praguri REALISTE
const CONFIG = {
  pushup: { DOWN: 100, UP: 155 },
  squat: { DOWN: 110, UP: 165 }
};

// ───────── UTILS ─────────
function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  return Math.acos(dot / (magAB * magCB)) * 180 / Math.PI;
}

function valid(p) {
  return p && p.score > 0.5;
}

function isPlank(shoulder, hip, ankle) {
  return (
    Math.abs(shoulder.y - hip.y) < 50 &&
    Math.abs(hip.y - ankle.y) < 50
  );
}

// ───────── CAMERA ─────────
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: isMobile ? "environment" : "user",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  });
  video.srcObject = stream;
  return new Promise(r => video.onloadedmetadata = r);
}

// ───────── MAIN ─────────
async function main() {
  await setupCamera();

  const detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.THUNDER }
  );

  async function detect() {
    const poses = await detector.estimatePoses(video);
    if (!poses.length) return requestAnimationFrame(detect);

    const kp = poses[0].keypoints;
    const g = name => kp.find(p => p.name === name && valid(p));

    const rs = g("right_shoulder");
    const re = g("right_elbow");
    const rw = g("right_wrist");
    const rh = g("right_hip");
    const rk = g("right_knee");
    const ra = g("right_ankle");

    const now = Date.now();

    // ───── FLO T Ă R I ─────
    if (exercise === "pushup" && rs && re && rw && rh && ra) {

      if (!isPlank(rs, rh, ra)) {
        state = "UP";
        return requestAnimationFrame(detect);
      }

      const elbowA = angle(rs, re, rw);

      if (elbowA < CONFIG.pushup.DOWN && state === "UP") {
        state = "DOWN";
      }

      if (
        elbowA > CONFIG.pushup.UP &&
        state === "DOWN" &&
        now - lastRepTime > 600
      ) {
        count++;
        countEl.textContent = count;
        state = "UP";
        lastRepTime = now;
      }
    }

    // ───── G E N U F L E X I U N I ─────
    if (exercise === "squat" && rh && rk && ra) {

      const kneeA = angle(rh, rk, ra);

      if (kneeA < CONFIG.squat.DOWN && state === "UP") {
        state = "DOWN";
      }

      if (
        kneeA > CONFIG.squat.UP &&
        state === "DOWN" &&
        now - lastRepTime > 600
      ) {
        count++;
        countEl.textContent = count;
        state = "UP";
        lastRepTime = now;
      }
    }

    requestAnimationFrame(detect);
  }

  detect();
}

toggleBtn.onclick = () => {
  exercise = exercise === "pushup" ? "squat" : "pushup";
  exerciseEl.textContent = exercise === "pushup" ? "Flotări" : "Genuflexiuni";
  count = 0;
  countEl.textContent = 0;
  state = "UP";
};

main();
