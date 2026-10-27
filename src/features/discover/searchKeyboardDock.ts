export function searchKeyboardGeometry(layoutHeight: number, visibleHeight: number, offsetTop: number, baselineHeight: number) {
  return {
    bottom: Math.max(0, layoutHeight - visibleHeight - offsetTop),
    keyboard: baselineHeight - visibleHeight > 120,
  };
}
