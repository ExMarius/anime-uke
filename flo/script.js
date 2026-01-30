const video = document.getElementById("video");
const counter = document.getElementById("count");

let count = 0;
let state = "UP";
let lastRepTime = 0;

function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  return Math.acos(dot / (magAB * magCB)) * 180 / Math.PI;
}

function isBodyHorizontal(shoulder, hip) {
  return Math.abs(shoulder.y - hip.y) < 40;
}

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" }
  });
  video.srcObject = stream;
  return new Promise(res => video.onloadedmetadata = res);
}

async function main() {
  await setupCamera();

  const detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.THUNDER }
  );

  async function detect() {
    const poses = await detector.estimatePoses(video);
    if (!poses.length) {
      requestAnimationFrame(detect);
      return;
    }

    const kp = poses[0].keypoints;
    const s = n => kp.find(p => p.name === n && p.score > 0.5);

    const shoulder = s("right_shoulder");
    const elbow = s("right_elbow");
    const wrist = s("right_wrist");
    const hip = s("right_hip");

    if (!shoulder || !elbow || !wrist || !hip) {
      requestAnimationFrame(detect);
      return;
    }

    // ❗ validare poziție flotare
    if (!isBodyHorizontal(shoulder, hip)) {
      state = "UP";
      requestAnimationFrame(detect);
      return;
    }

    const a = angle(shoulder, elbow, wrist);
    const now = Date.now();

    if (a < 85 && state === "UP") {
      state = "DOWN";
    }

    if (a > 165 && state === "DOWN" && now - lastRepTime > 600) {
      count++;
      counter.textContent = count;
      state = "UP";
      lastRepTime = now;
    }

    requestAnimationFrame(detect);
  }

  detect();
}

main();
