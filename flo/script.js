const video = document.getElementById("video");
const counter = document.getElementById("count");

let count = 0;
let state = "UP";
let angleHistory = [];

const MAX_HISTORY = 5;

function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  return Math.acos(dot / (magAB * magCB)) * 180 / Math.PI;
}

function smooth(val) {
  angleHistory.push(val);
  if (angleHistory.length > MAX_HISTORY) angleHistory.shift();
  return angleHistory.reduce((a,b)=>a+b,0) / angleHistory.length;
}

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  return new Promise(res => video.onloadedmetadata = res);
}

async function main() {
  await setupCamera();

  const detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.THUNDER
    }
  );

  async function detect() {
    const poses = await detector.estimatePoses(video);
    if (poses.length) {
      const kp = poses[0].keypoints;

      const rShoulder = kp.find(p=>p.name==="right_shoulder");
      const rElbow    = kp.find(p=>p.name==="right_elbow");
      const rWrist    = kp.find(p=>p.name==="right_wrist");

      if (rShoulder && rElbow && rWrist) {
        let a = angle(rShoulder, rElbow, rWrist);
        a = smooth(a);

        if (a < 90 && state === "UP") state = "DOWN";
        if (a > 165 && state === "DOWN") {
          count++;
          counter.textContent = count;
          state = "UP";
        }
      }
    }
    requestAnimationFrame(detect);
  }

  detect();
}

main();
