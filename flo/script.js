const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const counterEl = document.getElementById("count");

let count = 0;
let down = false;

function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  return Math.acos(dot / (magAB * magCB)) * (180 / Math.PI);
}

const pose = new Pose({
  locateFile: file =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity: 0,
  smoothLandmarks: true
});

pose.onResults(results => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.poseLandmarks) return;

  const shoulder = results.poseLandmarks[12];
  const elbow = results.poseLandmarks[14];
  const wrist = results.poseLandmarks[16];

  const elbowAngle = angle(shoulder, elbow, wrist);

  if (elbowAngle < 90) down = true;
  if (elbowAngle > 160 && down) {
    count++;
    counterEl.textContent = count;
    down = false;
  }
});

const camera = new Camera(video, {
  onFrame: async () => {
    await pose.send({ image: video });
  },
  width: 640,
  height: 480
});

camera.start();
