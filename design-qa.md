# Design QA — Physical Pose Mapping, Rear Occlusion, and Rear Industrial Design

- Reported symptom: Android phone is flat on a table while the web phone remains upright.
- Live verification screenshot: `E:\project\uav-system-ai\output\y-axis-flat-final.png`
- Browser viewport requested: 1440 × 1024 CSS px, device scale factor 1
- Captured in-app browser surface: 1014 × 920 px
- State: real pose, connected Sensor 3DoF, Android phone physically flat

## Findings

- The regression was caused by treating the calibrated device quaternion as web identity. Identity faces the web camera, so a physically flat phone appeared upright.
- Sensor 3DoF now applies a fixed Android Z-up → Three.js Y-up basis conversion before rendering.
- Calibration is yaw-only again. It changes heading but preserves gravity-derived pitch and roll.
- The pose inspector now reports rendered coordinates rather than raw Android coordinates.
- The independent rear shell remains removed; the verified flat side view is one continuous thin rail.
- The projected HTML screen previously rendered from both sides because its CSS 3D plane had no back-face culling and the chassis had no flush rear occluder.
- The screen now uses CSS back-face culling, while a zero-thickness rear glass plane closes the back at the chassis surface. This blocks the live image from the rear without recreating the earlier double-thick phone shell.

## Evidence

- Before the correction, the connected flat phone reported approximately pitch −0.01°, yaw 0.09°, roll 5.07° and rendered upright.
- After the correction, the same physical phone renders flat and the inspector reports pitch −90.53°, matching the visible orientation.
- At pitch near ±90°, Euler yaw is mathematically unstable, so the displayed yaw value may change while flat even though the quaternion and rendered pose remain correct.
- Rear-face verification screenshot: `E:\project\uav-system-ai\output\back-face-verification-v2.png`
- Verification state: simulated ARCore 6DoF quaternion rotated 180° around Y at a 1440 × 1024 CSS-pixel viewport.
- The rear view is a continuous solid emerald surface; no `SCAN` placeholder or projected Android frame is visible through the back.

## Comparison history

1. Full-quaternion zeroing pass:
   - P1: made the calibration pose front-facing regardless of gravity.
2. Physical-coordinate correction:
   - Restored yaw-only calibration in Sensor 3DoF and ARCore 6DoF.
   - Restored Android-to-Three basis conversion for Sensor 3DoF.
   - Removed presentation angle clamping from real-pose mode.
   - Restored mode-handoff decay so ARCore/Sensor switching converges to the physical frame.
   - Updated the inspector to display rendered Euler angles.
3. Post-fix browser evidence:
   - The connected phone was observed flat on the stage as a single thin profile.
   - No actionable P0/P1/P2 issue remains for this axis-mapping symptom.
4. Rear-face correction:
   - Added back-face culling to the CSS screen plane.
   - Added a flush, zero-thickness rear glass occluder.
   - Rotated the model to an exact 180° rear view and confirmed that the screen content is fully hidden.

## Verification

- `npm run build` passed.
- Android `:app:assembleDebug` passed.
- Fresh browser reload contains no application errors; only the existing non-blocking Three.js `Clock` deprecation warning remains.
- APK: `E:\project\uav-system-ai\output\MotionCast-Tracker-debug.apk`
- APK SHA-256: `7474A57BA3E51AA7BC6D7EB79E868E2359135D425930406E97FF545EAC55B9EC`

## Rear Industrial Design QA

- Source visual truth: `E:\project\uav-system-ai\output\rear-design-reference.png`
- Browser-rendered implementation: `E:\project\uav-system-ai\output\rear-design-implementation.png`
- Focused implementation crop: `E:\project\uav-system-ai\output\rear-design-focused.png`
- Side-by-side focused comparison: `E:\project\uav-system-ai\output\rear-design-focused-comparison.png`
- Source dimensions: 1086 × 1448 px.
- Implementation dimensions: 1440 × 1024 px at a 1440 × 1024 CSS-pixel viewport, device scale factor 1.
- Focused implementation dimensions: 380 × 650 px, cropped from the browser capture without scaling.
- State: emerald frame, showcase rear three-quarter QA pose. The production showcase pose was restored to its normal front three-quarter view after capture.

### Full-view comparison evidence

- The page keeps the established warm off-white product-studio scene and inspector layout while the rear design remains the visual focal point.
- The rear is opaque and uses one continuous, thin body. No duplicated case, rear screen image, or detached shell is visible.
- The source and implementation share the same restrained premium direction: satin emerald back glass, compact upper-left camera island, three black lenses, warm flash, depth sensor, subtle centered linked emblem, and a minimal lower technical line.

### Focused-region comparison evidence

- Camera-island width, lens hierarchy, top/side margins, and the phone's corner radii remain proportionally close to the reference.
- Lens surfaces retain distinct dark glass, blue specular highlights, metal rings, and a shallow physical stack rather than a flat graphic.
- The centered emblem was changed from two horizontal circles to two offset elliptical links to match the selected reference more closely.

### Required fidelity surfaces

- Fonts and typography: unchanged; this pass adds no product text and does not disturb the established UI type hierarchy.
- Spacing and layout rhythm: camera island stays inside the existing chassis bounds with balanced top and side margins; the center emblem and lower line follow the phone's vertical axis.
- Colors and visual tokens: all five selectable frame colors now have coordinated rear-glass and camera-island tones; emerald uses a darker satin back against the brighter anodized rail.
- Image quality and asset fidelity: the selected product-mockup reference was preserved in the workspace; the implementation uses real shaded Three.js geometry and physical materials for correct live 360° parallax, with no raster placeholder or rear-screen leakage.
- Copy and content: no new visible copy was introduced; existing pairing, pose, status, and calibration content remains unchanged.

### Rear-design comparison history

1. Initial rear occluder:
   - P2: visually correct but too plain; it was a single uninterrupted green surface.
2. First industrial-design pass:
   - Added a three-lens camera island, flash, depth sensor, differentiated satin back material, center emblem, and lower detail line.
   - P2: initial lens stack and emblem read slightly heavy.
3. Final refinement:
   - Reduced camera-island and lens protrusion, reduced flash size, darkened the emerald back, thinned the center emblem, and changed it to offset linked ellipses.
   - Post-fix focused comparison shows no actionable P0/P1/P2 mismatch.

### Interaction and runtime verification

- `npm run build` passed after restoring the normal showcase pose.
- Emerald, silver, and graphite swatches were exercised and emerald was restored.
- A fresh browser reload contains no application errors; only the existing non-blocking Three.js `Clock` deprecation warning remains.

## Hardware acceptance

- Install the rebuilt APK for yaw-only calibration behavior. Put the phone flat, calibrate horizontal heading, then lift and tilt it; the web model should start flat and follow the same physical tilt.

final result: passed
