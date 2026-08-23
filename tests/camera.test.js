// カメラ管理のテスト
import { describe, expect, test, beforeEach } from "bun:test";
import {
  DEFAULT_CAMERA_NAME,
  defaultCameraParams,
  addCamera,
  getCamera,
  cameraNames,
  removeCamera,
  clearCameras,
  setCamera,
  setActiveCamera,
  activeCamera,
  viewMatrix,
  projectionMatrix,
  lensToFov,
  fovToLens,
  SENSOR_HEIGHT_MM,
} from "../web/camera.js";
import { transformPoint } from "../web/matrix.js";

beforeEach(() => clearCameras());

describe("既定のカメラ", () => {
  test("プロジェクトには必ず既定のカメラが1つある", () => {
    expect(cameraNames()).toEqual([DEFAULT_CAMERA_NAME]);
    expect(getCamera(DEFAULT_CAMERA_NAME)).not.toBeNull();
  });

  test("既定のカメラが最初から選ばれている", () => {
    expect(activeCamera().name).toBe(DEFAULT_CAMERA_NAME);
  });

  test("XY平面を右斜め上から見下ろす向きになっている", () => {
    const c = getCamera(DEFAULT_CAMERA_NAME);
    // 右（+X）・上（+Y）・手前（+Z）に居て、原点を見ている
    expect(c.X).toBeGreaterThan(0);
    expect(c.Y).toBeGreaterThan(0);
    expect(c.Z).toBeGreaterThan(0);
    expect([c.targetX, c.targetY, c.targetZ]).toEqual([0, 0, 0]);
  });

  test("既定値は使い回しても書き換わらない", () => {
    const a = defaultCameraParams();
    a.X = 999;
    expect(defaultCameraParams().X).not.toBe(999);
  });

  test("消してもすぐ既定のカメラだけに戻る", () => {
    addCamera({ name: "sub" });
    clearCameras();
    expect(cameraNames()).toEqual([DEFAULT_CAMERA_NAME]);
  });
});

describe("カメラの追加と取り出し", () => {
  test("名前を付けて追加できる", () => {
    const camera = addCamera({ name: "sub", X: 1, Y: 2, Z: 3 });
    expect(camera.name).toBe("sub");
    expect([camera.X, camera.Y, camera.Z]).toEqual([1, 2, 3]);
    expect(getCamera("sub")).toBe(camera);
  });

  test("省略した項目は既定値で埋まる", () => {
    const camera = addCamera({ name: "sub" });
    const base = defaultCameraParams();
    expect(camera.fov).toBe(base.fov);
    expect(camera.near).toBe(base.near);
    expect(camera.far).toBe(base.far);
  });

  test("複数のカメラを持てる", () => {
    addCamera({ name: "sub1" });
    addCamera({ name: "sub2" });
    expect(cameraNames().sort()).toEqual([DEFAULT_CAMERA_NAME, "sub1", "sub2"].sort());
  });

  test("同じ名前で追加すると置き換わる", () => {
    addCamera({ name: "sub", X: 1 });
    addCamera({ name: "sub", X: 2 });
    expect(getCamera("sub").X).toBe(2);
    expect(cameraNames().length).toBe(2);
  });

  test("名前が無ければ例外にする", () => {
    expect(() => addCamera({ X: 1 })).toThrow();
    expect(() => addCamera()).toThrow();
  });

  test("知らない名前は null を返す", () => {
    expect(getCamera("unknown")).toBeNull();
  });

  test("カメラを消せる", () => {
    addCamera({ name: "sub" });
    removeCamera("sub");
    expect(getCamera("sub")).toBeNull();
  });

  test("既定のカメラは消せない", () => {
    removeCamera(DEFAULT_CAMERA_NAME);
    expect(getCamera(DEFAULT_CAMERA_NAME)).not.toBeNull();
  });
});

describe("表示に使うカメラの切り替え", () => {
  test("指定したカメラに切り替わる", () => {
    addCamera({ name: "sub", X: 5 });
    setActiveCamera("sub");
    expect(activeCamera().name).toBe("sub");
  });

  test("知らない名前は例外にする", () => {
    expect(() => setActiveCamera("unknown")).toThrow();
  });

  test("選んでいたカメラを消すと既定へ戻る", () => {
    addCamera({ name: "sub" });
    setActiveCamera("sub");
    removeCamera("sub");
    expect(activeCamera().name).toBe(DEFAULT_CAMERA_NAME);
  });
});

describe("出力先", () => {
  test("既定は画面へ出す", () => {
    expect(getCamera(DEFAULT_CAMERA_NAME).output).toBe("screen");
  });

  test("テクスチャへ出すカメラを作れる", () => {
    const camera = addCamera({ name: "mirror", output: "texture" });
    expect(camera.output).toBe("texture");
  });

  test("知らない出力先は画面扱いにする", () => {
    expect(addCamera({ name: "x", output: "unknown" }).output).toBe("screen");
  });
});

describe("カメラ行列", () => {
  test("視点が原点へ移る", () => {
    const camera = addCamera({ name: "sub", X: 0, Y: 0, Z: 10 });
    const p = transformPoint(viewMatrix(camera), [0, 0, 10]);
    for (const v of p) expect(Math.abs(v)).toBeLessThan(1e-6);
  });

  test("注視点はカメラの前方（負のZ）に来る", () => {
    const camera = addCamera({ name: "sub", X: 0, Y: 0, Z: 10 });
    expect(transformPoint(viewMatrix(camera), [0, 0, 0])[2]).toBeLessThan(0);
  });

  test("投影行列は縦横比を反映する", () => {
    const camera = getCamera(DEFAULT_CAMERA_NAME);
    const square = projectionMatrix(camera, 1);
    const wide = projectionMatrix(camera, 2);
    expect(wide[0]).toBeLessThan(square[0]);
  });

  test("画角は度で指定する", () => {
    // 既定は45度（ラジアンに直して使う）
    expect(getCamera(DEFAULT_CAMERA_NAME).fov).toBe(45);
  });
});

describe("カメラの更新（setCamera）", () => {
  test("注視点だけを変えられる", () => {
    addCamera({ name: "sub", X: 1, Y: 2, Z: 3, targetX: 0, targetY: 0, targetZ: 0 });
    setCamera({ name: "sub", targetX: 10, targetY: 20, targetZ: 30 });

    const c = getCamera("sub");
    expect([c.targetX, c.targetY, c.targetZ]).toEqual([10, 20, 30]);
    // 指定しなかった項目はそのまま
    expect([c.X, c.Y, c.Z]).toEqual([1, 2, 3]);
  });

  test("位置と注視点をまとめて変えられる", () => {
    setCamera({
      name: DEFAULT_CAMERA_NAME,
      X: 0, Y: 30, Z: 0,
      targetX: 5, targetY: 0, targetZ: 5,
    });
    const c = getCamera(DEFAULT_CAMERA_NAME);
    expect([c.X, c.Y, c.Z]).toEqual([0, 30, 0]);
    expect([c.targetX, c.targetY, c.targetZ]).toEqual([5, 0, 5]);
  });

  test("名前を省略すると表示に使っているカメラを変える", () => {
    addCamera({ name: "sub" });
    setActiveCamera("sub");
    setCamera({ targetX: 7 });
    expect(getCamera("sub").targetX).toBe(7);
    expect(getCamera(DEFAULT_CAMERA_NAME).targetX).toBe(0);
  });

  test("名前は変えられない", () => {
    addCamera({ name: "sub" });
    setCamera({ name: "sub", name2: "x" });
    expect(getCamera("sub").name).toBe("sub");
  });

  test("知らない名前は例外にする", () => {
    expect(() => setCamera({ name: "unknown", X: 1 })).toThrow();
  });

  test("更新後のカメラを返す", () => {
    const c = setCamera({ name: DEFAULT_CAMERA_NAME, fov: 60 });
    expect(c.fov).toBe(60);
    expect(c).toBe(getCamera(DEFAULT_CAMERA_NAME));
  });

  test("出力先も変えられる", () => {
    setCamera({ name: DEFAULT_CAMERA_NAME, output: "texture" });
    expect(getCamera(DEFAULT_CAMERA_NAME).output).toBe("texture");
    // 知らない値は画面扱いに戻す
    setCamera({ name: DEFAULT_CAMERA_NAME, output: "bogus" });
    expect(getCamera(DEFAULT_CAMERA_NAME).output).toBe("screen");
  });
});

describe("焦点距離（mm）での画角指定", () => {
  /** 誤差を許して比べる */
  const near = (a, b, tol = 0.05) => expect(Math.abs(a - b)).toBeLessThan(tol);

  test("35mmフルサイズ換算を基準にする", () => {
    // 縦24mm（36x24mm）を基準に縦画角を求める
    expect(SENSOR_HEIGHT_MM).toBe(24);
  });

  test("よく使う焦点距離が一般的な画角になる", () => {
    near(lensToFov(24), 53.1);
    near(lensToFov(28), 46.4);
    near(lensToFov(35), 37.8);
    near(lensToFov(50), 27.0);
    near(lensToFov(85), 16.1);
  });

  test("画角から焦点距離へも戻せる", () => {
    near(fovToLens(53.1), 24, 0.1);
    near(fovToLens(27.0), 50, 0.1);
  });

  test("往復変換で元へ戻る", () => {
    for (const mm of [14, 24, 50, 85, 200]) {
      near(fovToLens(lensToFov(mm)), mm, 0.001);
    }
  });

  test("焦点距離を指定してカメラを作れる", () => {
    const c = addCamera({ name: "tele", lens: 85 });
    expect(c.lens).toBe(85);
    near(c.fov, 16.1);
  });

  test("焦点距離を後から変えられる", () => {
    setCamera({ name: DEFAULT_CAMERA_NAME, lens: 50 });
    const c = getCamera(DEFAULT_CAMERA_NAME);
    expect(c.lens).toBe(50);
    near(c.fov, 27.0);
  });

  test("画角を指定すると焦点距離も追従する", () => {
    setCamera({ name: DEFAULT_CAMERA_NAME, fov: 53.13 });
    near(getCamera(DEFAULT_CAMERA_NAME).lens, 24, 0.05);
  });

  test("両方指定した場合は焦点距離を優先する", () => {
    const c = addCamera({ name: "both", fov: 90, lens: 50 });
    near(c.fov, 27.0);
    expect(c.lens).toBe(50);
  });

  test("既定カメラも焦点距離を持つ", () => {
    // 画角45度は約29mmに相当する
    near(getCamera(DEFAULT_CAMERA_NAME).lens, 29.0, 0.1);
  });

  test("扱えない焦点距離は無視する", () => {
    const before = getCamera(DEFAULT_CAMERA_NAME).lens;
    setCamera({ name: DEFAULT_CAMERA_NAME, lens: 0 });
    expect(getCamera(DEFAULT_CAMERA_NAME).lens).toBe(before);
    setCamera({ name: DEFAULT_CAMERA_NAME, lens: -10 });
    expect(getCamera(DEFAULT_CAMERA_NAME).lens).toBe(before);
  });
});
