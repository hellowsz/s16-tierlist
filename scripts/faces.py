"""用 macOS Vision 检测人脸。需要 pyobjc-framework-Vision。"""
import Quartz
import Vision
from Foundation import NSURL


def detect_faces(path):
    """返回 (宽高比, [[x, y, w, h], ...])，坐标为左上原点的 0~1 比例；读图失败返回 (None, [])。"""
    src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(str(path)), None)
    if src is None:
        return None, []
    cg = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    if cg is None:
        return None, []
    aspect = Quartz.CGImageGetWidth(cg) / Quartz.CGImageGetHeight(cg)
    req = Vision.VNDetectFaceRectanglesRequest.alloc().init()
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, {})
    ok, err = handler.performRequests_error_([req], None)
    if not ok:
        raise RuntimeError(f"Vision failed on {path}: {err}")
    faces = []
    for f in req.results() or []:
        b = f.boundingBox()
        faces.append([b.origin.x, 1 - b.origin.y - b.size.height, b.size.width, b.size.height])
    return aspect, faces
