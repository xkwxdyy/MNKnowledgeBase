var KnowledgeBaseHandwritingOCR = (function () {
  "use strict"

  var BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  var MAX_DRAWING_BASE64_LENGTH = 8 * 1024 * 1024
  var MAX_FIELDS_PER_MESSAGE = 200000
  var MAX_STROKES = 10000
  var MAX_POINTS_PER_STROKE = 100000
  var MAX_TOTAL_POINTS = 500000
  var MAX_SVG_LENGTH = 20 * 1024 * 1024
  var MAX_RASTER_DATA_URI_LENGTH = 24 * 1024 * 1024
  var RASTER_TARGET_LONG_EDGE = 2048
  var RASTER_MAX_PIXELS = 4 * 1024 * 1024
  var RASTER_JPEG_QUALITY = 0.9
  var RASTER_CACHE_LIMIT = 6
  var RASTER_TIMEOUT_MS = 15000
  var rasterQueue = Promise.resolve()
  var rasterCache = Object.create(null)
  var rasterCacheOrder = []

  function createError(code, message) {
    var error = new Error(message || code)
    error.code = code
    return error
  }

  function logPerformance(detail) {
    try {
      console.log("[MNKB Handwriting OCR Performance] " + JSON.stringify(detail))
    } catch (_) {}
  }

  function getCachedRaster(mediaId) {
    var key = String(mediaId || "")
    if (!key || !Object.prototype.hasOwnProperty.call(rasterCache, key)) return null
    var index = rasterCacheOrder.indexOf(key)
    if (index >= 0) rasterCacheOrder.splice(index, 1)
    rasterCacheOrder.push(key)
    return rasterCache[key]
  }

  function setCachedRaster(mediaId, value) {
    var key = String(mediaId || "")
    if (!key || !value || !value.data) return
    var index = rasterCacheOrder.indexOf(key)
    if (index >= 0) rasterCacheOrder.splice(index, 1)
    rasterCache[key] = value
    rasterCacheOrder.push(key)
    while (rasterCacheOrder.length > RASTER_CACHE_LIMIT) {
      delete rasterCache[rasterCacheOrder.shift()]
    }
  }

  function normalizeBase64(value) {
    var input = String(value || "")
      .replace(/^data:[^,]+,/, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/\s/g, "")
    if (!input || input.length > MAX_DRAWING_BASE64_LENGTH) {
      throw createError("drawing-size-invalid", "手写数据为空或过大")
    }
    if (input.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input)) {
      throw createError("invalid-base64", "手写数据 Base64 格式无效")
    }
    return input
  }

  function decodeBase64(value) {
    var input = normalizeBase64(value)
    var padding = input.endsWith("==") ? 2 : (input.endsWith("=") ? 1 : 0)
    var outputLength = Math.floor(input.length * 3 / 4) - padding
    var output = new Uint8Array(Math.max(0, outputLength))
    var outputIndex = 0
    var buffer = 0
    var bits = 0
    for (var index = 0; index < input.length; index += 1) {
      var character = input.charAt(index)
      if (character === "=") break
      var valueIndex = BASE64_CHARS.indexOf(character)
      if (valueIndex < 0) throw createError("invalid-base64-character", "手写数据包含无效字符")
      buffer = (buffer << 6) | valueIndex
      bits += 6
      if (bits >= 8) {
        bits -= 8
        if (outputIndex < output.length) output[outputIndex] = (buffer >> bits) & 255
        outputIndex += 1
      }
    }
    return outputIndex === output.length ? output : output.slice(0, outputIndex)
  }

  function encodeBase64(value) {
    var input = String(value || "")
    var output = ""
    for (var index = 0; index < input.length; index += 3) {
      var first = input.charCodeAt(index) & 255
      var hasSecond = index + 1 < input.length
      var hasThird = index + 2 < input.length
      var second = hasSecond ? input.charCodeAt(index + 1) & 255 : 0
      var third = hasThird ? input.charCodeAt(index + 2) & 255 : 0
      var combined = (first << 16) | (second << 8) | third
      output += BASE64_CHARS.charAt((combined >> 18) & 63)
      output += BASE64_CHARS.charAt((combined >> 12) & 63)
      output += hasSecond ? BASE64_CHARS.charAt((combined >> 6) & 63) : "="
      output += hasThird ? BASE64_CHARS.charAt(combined & 63) : "="
    }
    return output
  }

  function readVarint(data, start) {
    var result = 0
    var shift = 0
    var position = start
    while (position < data.length) {
      var byte = data[position++]
      result += (byte & 127) * Math.pow(2, shift)
      if ((byte & 128) === 0) return { value: result, position: position }
      shift += 7
      if (shift > 49) throw createError("varint-too-long", "手写数据字段过长")
    }
    throw createError("truncated-varint", "手写数据字段不完整")
  }

  function ensureAvailable(position, length, end, stage) {
    if (!Number.isFinite(length) || length < 0 || position + length > end) {
      throw createError("truncated-" + stage, "手写数据在 " + stage + " 阶段不完整")
    }
  }

  function parseFields(data) {
    var fields = []
    var position = 0
    var end = data.length
    var view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    while (position < end) {
      if (fields.length >= MAX_FIELDS_PER_MESSAGE) {
        throw createError("too-many-fields", "手写数据字段数量过多")
      }
      var tagResult = readVarint(data, position)
      position = tagResult.position
      var fieldNumber = Math.floor(tagResult.value / 8)
      var wireType = tagResult.value & 7
      if (!fieldNumber) throw createError("invalid-field-number", "手写数据字段编号无效")
      var field = { field: fieldNumber, wireType: wireType }
      if (wireType === 0) {
        var varint = readVarint(data, position)
        field.value = varint.value
        position = varint.position
      } else if (wireType === 1) {
        ensureAvailable(position, 8, end, "fixed64")
        field.double = view.getFloat64(position, true)
        position += 8
      } else if (wireType === 2) {
        var lengthResult = readVarint(data, position)
        position = lengthResult.position
        ensureAvailable(position, lengthResult.value, end, "bytes")
        field.raw = data.slice(position, position + lengthResult.value)
        position += lengthResult.value
      } else if (wireType === 5) {
        ensureAvailable(position, 4, end, "fixed32")
        field.float = view.getFloat32(position, true)
        position += 4
      } else {
        throw createError("unsupported-wire-type", "手写数据包含不支持的字段类型 " + wireType)
      }
      fields.push(field)
    }
    return fields
  }

  function groupFields(fields) {
    var grouped = {}
    for (var index = 0; index < fields.length; index += 1) {
      var field = fields[index]
      if (!grouped[field.field]) grouped[field.field] = []
      grouped[field.field].push(field)
    }
    return grouped
  }

  function firstField(grouped, number) {
    return grouped[number] && grouped[number][0] ? grouped[number][0] : null
  }

  function decodePoints(raw, declaredPointCount) {
    var view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    var points = []
    var pointCount = Number(declaredPointCount) > 0
      ? Math.floor(Number(declaredPointCount))
      : Math.floor(raw.length / 12)
    if (pointCount > MAX_POINTS_PER_STROKE) {
      throw createError("too-many-points-in-stroke", "单笔手写点数过多")
    }
    var pointStride = pointCount > 0 ? Math.floor(raw.length / pointCount) : 12
    if (pointStride < 12) throw createError("invalid-point-stride", "手写点记录长度无效")
    for (var index = 0; index < pointCount; index += 1) {
      var offset = index * pointStride
      if (offset + 12 > raw.length) break
      var x = view.getFloat32(offset, true)
      var y = view.getFloat32(offset + 4, true)
      var time = view.getFloat32(offset + 8, true)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      points.push({ x: x, y: y, t: Number.isFinite(time) ? time : 0 })
    }
    return points
  }

  function floatValue(grouped, number, defaultValue) {
    var field = firstField(grouped, number)
    return field && Number.isFinite(field.float) ? field.float : defaultValue
  }

  function decodeStroke(raw, index) {
    var grouped = groupFields(parseFields(raw))
    var stroke = { index: index, points: [], transformedPoints: [] }
    var strokeDataField = firstField(grouped, 5)
    if (strokeDataField && strokeDataField.raw) {
      var strokeData = groupFields(parseFields(strokeDataField.raw))
      var pointCountField = firstField(strokeData, 3)
      var pointsField = firstField(strokeData, 7)
      if (pointsField && pointsField.raw) {
        stroke.points = decodePoints(pointsField.raw, pointCountField ? pointCountField.value : 0)
      }
    }

    var transformField = firstField(grouped, 7)
    var transform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    if (transformField && transformField.raw) {
      var transformFields = groupFields(parseFields(transformField.raw))
      transform = {
        a: floatValue(transformFields, 1, 1),
        b: floatValue(transformFields, 2, 0),
        c: floatValue(transformFields, 3, 0),
        d: floatValue(transformFields, 4, 1),
        tx: floatValue(transformFields, 5, 0),
        ty: floatValue(transformFields, 6, 0),
      }
    }

    stroke.transformedPoints = stroke.points.map(function (point) {
      return {
        x: transform.a * point.x + transform.c * point.y + transform.tx,
        y: transform.b * point.x + transform.d * point.y + transform.ty,
        t: point.t,
      }
    }).filter(function (point) {
      return Number.isFinite(point.x) && Number.isFinite(point.y)
    })
    return stroke
  }

  function decodeInkData(data) {
    if (data.length < 6) throw createError("truncated-header", "手写数据头不完整")
    if (data[0] !== 119 || data[1] !== 114 || data[2] !== 100) {
      throw createError("invalid-magic-header", "无法识别当前手写数据格式")
    }
    var grouped = groupFields(parseFields(data.slice(6)))
    var strokeFields = grouped[5] || []
    if (strokeFields.length > MAX_STROKES) throw createError("too-many-strokes", "手写笔画数量过多")
    var strokes = []
    var totalPoints = 0
    for (var index = 0; index < strokeFields.length; index += 1) {
      if (!strokeFields[index].raw) continue
      var stroke = decodeStroke(strokeFields[index].raw, index)
      if (stroke.transformedPoints.length === 0) continue
      totalPoints += stroke.transformedPoints.length
      if (totalPoints > MAX_TOTAL_POINTS) throw createError("too-many-points", "手写总点数过多")
      strokes.push(stroke)
    }
    if (strokes.length === 0) throw createError("no-valid-strokes", "没有解析到有效手写笔画")

    var penSize = 3
    var metadataField = firstField(grouped, 4)
    if (metadataField && metadataField.raw) {
      var metadata = groupFields(parseFields(metadataField.raw))
      var penField = firstField(metadata, 8)
      if (penField && Number.isFinite(penField.double) && penField.double > 0) {
        penSize = Math.max(1, Math.min(12, Math.abs(penField.double)))
      }
    }
    return { strokes: strokes, penSize: penSize }
  }

  function computeBounds(strokes) {
    var minX = Infinity
    var minY = Infinity
    var maxX = -Infinity
    var maxY = -Infinity
    for (var strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
      var points = strokes[strokeIndex].transformedPoints
      for (var pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        var point = points[pointIndex]
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
      }
    }
    if (!Number.isFinite(minX)) throw createError("no-valid-bounds", "无法计算手写边界")
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  function formatNumber(value) {
    return Number(value).toFixed(2)
  }

  function renderSvg(strokes, bounds, penSize) {
    var margin = Math.max(30, penSize * 6)
    var width = Math.max(1, bounds.width + margin * 2)
    var height = Math.max(1, bounds.height + margin * 2)
    var minX = bounds.x - margin
    var minY = bounds.y - margin
    var parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width.toFixed(1) + '" height="' + height.toFixed(1) + '" viewBox="' +
        minX.toFixed(1) + " " + minY.toFixed(1) + " " + width.toFixed(1) + " " + height.toFixed(1) + '">',
      '<rect x="' + minX.toFixed(1) + '" y="' + minY.toFixed(1) + '" width="' + width.toFixed(1) + '" height="' + height.toFixed(1) + '" fill="white"/>',
    ]
    for (var strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
      var points = strokes[strokeIndex].transformedPoints
      if (points.length === 1) {
        parts.push('<circle cx="' + formatNumber(points[0].x) + '" cy="' + formatNumber(points[0].y) + '" r="' + (penSize / 2) + '" fill="#1d1d1f"/>')
        continue
      }
      var path = "M " + formatNumber(points[0].x) + " " + formatNumber(points[0].y)
      for (var pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        path += " L " + formatNumber(points[pointIndex].x) + " " + formatNumber(points[pointIndex].y)
      }
      parts.push('<path d="' + path + '" fill="none" stroke="#1d1d1f" stroke-width="' + penSize + '" stroke-linecap="round" stroke-linejoin="round"/>')
    }
    parts.push("</svg>")
    var svg = parts.join("\n")
    if (svg.length > MAX_SVG_LENGTH) throw createError("svg-too-large", "手写 SVG 过大")
    return { svg: svg, width: width, height: height }
  }

  function renderDrawingDataURI(base64) {
    var decoded = decodeInkData(decodeBase64(base64))
    var bounds = computeBounds(decoded.strokes)
    var rendered = renderSvg(decoded.strokes, bounds, decoded.penSize)
    return {
      dataURI: "data:image/svg+xml;base64," + encodeBase64(rendered.svg),
      strokeCount: decoded.strokes.length,
      pointCount: decoded.strokes.reduce(function (count, stroke) {
        return count + stroke.transformedPoints.length
      }, 0),
      bounds: bounds,
      width: rendered.width,
      height: rendered.height,
    }
  }

  function arrayFromNative(value) {
    if (!value) return []
    if (Array.isArray(value)) return value
    try {
      var count = typeof value.count === "function" ? Number(value.count()) : Number(value.count)
      if (!Number.isFinite(count) || count <= 0) return []
      var result = []
      for (var index = 0; index < count; index += 1) {
        if (typeof value.objectAtIndex === "function") result.push(value.objectAtIndex(index))
        else result.push(value[index])
      }
      return result
    } catch (_) {
      return []
    }
  }

  function safeValue(object, key) {
    if (!object) return null
    try {
      var value = object[key]
      return value === undefined || value === null ? null : value
    } catch (_) {
      return null
    }
  }

  function getNativeNote(note) {
    return safeValue(note, "note") || note
  }

  function selectManualInput(note) {
    if (!note) return null
    var nativeNote = getNativeNote(note)
    var excerptPic = safeValue(note, "excerptPic") || safeValue(nativeNote, "excerptPic")
    var excerptPaint = safeValue(excerptPic, "paint")
    if (excerptPaint) {
      return { kind: "paint", mediaId: String(excerptPaint), source: "excerpt" }
    }

    var comments = arrayFromNative(safeValue(note, "comments"))
    if (comments.length === 0 && nativeNote !== note) {
      comments = arrayFromNative(safeValue(nativeNote, "comments"))
    }
    var firstComment = comments[0]
    if (!firstComment) return null

    var paint = safeValue(firstComment, "paint")
    var nestedPicture = safeValue(firstComment, "q_hpic")
    if (!paint && nestedPicture) paint = safeValue(nestedPicture, "paint")
    if (paint) {
      return { kind: "paint", mediaId: String(paint), source: "firstComment" }
    }

    var drawing = safeValue(firstComment, "drawing")
    if (!drawing && nestedPicture) drawing = safeValue(nestedPicture, "drawing")
    if (drawing) {
      return { kind: "drawing", mediaId: String(drawing), source: "firstComment" }
    }
    return null
  }

  function getMediaData(mediaId) {
    var data = null
    try {
      if (typeof MNUtil !== "undefined" && MNUtil && typeof MNUtil.getMediaByHash === "function") {
        data = MNUtil.getMediaByHash(mediaId)
      }
    } catch (_) {
      data = null
    }
    if (!data) {
      try {
        if (typeof Database !== "undefined" && Database && typeof Database.sharedInstance === "function") {
          data = Database.sharedInstance().getMediaByHash(mediaId)
        }
      } catch (_) {
        data = null
      }
    }
    return data
  }

  function getMediaBase64(mediaId) {
    var data = getMediaData(mediaId)
    if (!data) throw createError("drawing-media-missing", "找不到第一条评论的手写数据")
    var base64 = ""
    try {
      base64 = typeof data.base64Encoding === "function"
        ? data.base64Encoding()
        : data.base64Encoding
    } catch (_) {
      base64 = ""
    }
    if (!base64) throw createError("drawing-base64-missing", "无法读取第一条评论的手写数据")
    return String(base64)
  }

  function getRasterHostView() {
    try {
      if (typeof MNUtil !== "undefined" && MNUtil && MNUtil.studyView) return MNUtil.studyView
    } catch (_) {}
    try {
      var app = Application.sharedInstance()
      var controller = app.studyController(MNUtil.currentWindow)
      return controller && controller.view ? controller.view : null
    } catch (_) {
      return null
    }
  }

  function rasterHTML() {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="margin:0;background:#fff"><canvas id="canvas"></canvas><script>' +
      '(function(){' +
      'window.__MNKBInkStatus="ready";window.__MNKBInkResult="";window.__MNKBInkError="";window.__MNKBInkWidth=0;window.__MNKBInkHeight=0;' +
      'window.__MNKBInkRasterize=function(source,targetLongEdge,maxPixels,jpegQuality){' +
      'window.__MNKBInkStatus="working";var image=new Image();' +
      'image.onload=function(){try{' +
      'var sourceWidth=Math.max(1,Number(image.naturalWidth||image.width||1));' +
      'var sourceHeight=Math.max(1,Number(image.naturalHeight||image.height||1));' +
      'var longEdge=Math.max(sourceWidth,sourceHeight);var scale=Math.min(4,targetLongEdge/longEdge);' +
      'if(!isFinite(scale)||scale<=0)throw new Error("invalid-scale");' +
      'var pixelScale=Math.sqrt(maxPixels/(sourceWidth*sourceHeight));if(isFinite(pixelScale))scale=Math.min(scale,pixelScale);' +
      'var width=Math.max(1,Math.round(sourceWidth*scale));var height=Math.max(1,Math.round(sourceHeight*scale));' +
      'var canvas=document.getElementById("canvas");canvas.width=width;canvas.height=height;' +
      'var context=canvas.getContext("2d");context.fillStyle="#fff";context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);' +
      'window.__MNKBInkWidth=width;window.__MNKBInkHeight=height;window.__MNKBInkResult=canvas.toDataURL("image/jpeg",jpegQuality);window.__MNKBInkStatus="done";' +
      '}catch(error){window.__MNKBInkError=String(error&&error.message||error);window.__MNKBInkStatus="error";}};' +
      'image.onerror=function(){window.__MNKBInkError="svg-image-load-failed";window.__MNKBInkStatus="error";};image.src=source;};' +
      '})();</script></body></html>'
  }

  function dataURIToNSData(dataURI) {
    var match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataURI || ""))
    if (!match || dataURI.length > MAX_RASTER_DATA_URI_LENGTH) {
      throw createError("jpeg-result-invalid", "手写光栅图结果无效或过大")
    }
    var url = NSURL.URLWithString(dataURI)
    var data = url ? NSData.dataWithContentsOfURL(url) : null
    if (!data) throw createError("jpeg-decode-failed", "无法还原手写光栅图")
    var padding = match[1].endsWith("==") ? 2 : (match[1].endsWith("=") ? 1 : 0)
    return {
      data: data,
      base64Length: match[1].length,
      byteLength: Math.max(0, Math.floor(match[1].length * 3 / 4) - padding),
    }
  }

  function rasterizeDrawingDataURI(svgDataURI) {
    return new Promise(function (resolve, reject) {
      var hostView = getRasterHostView()
      if (!hostView || typeof hostView.addSubview !== "function") {
        reject(createError("raster-host-unavailable", "当前窗口无法创建手写渲染环境"))
        return
      }

      var webView = null
      var timer = null
      var startedAt = Date.now()
      var rasterStarted = false
      var evaluating = false
      var settled = false

      function cleanup() {
        try { if (timer && timer.isValid) timer.invalidate() } catch (_) {}
        timer = null
        try { if (webView && typeof webView.stopLoading === "function") webView.stopLoading() } catch (_) {}
        try { if (webView && typeof webView.removeFromSuperview === "function") webView.removeFromSuperview() } catch (_) {}
        webView = null
      }

      function finish(error, data) {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve(data)
      }

      try {
        webView = new UIWebView({ x: -4, y: -4, width: 2, height: 2 })
        webView.userInteractionEnabled = false
        try { webView.alpha = 0.01 } catch (_) {}
        hostView.addSubview(webView)
        webView.loadHTMLStringBaseURL(rasterHTML(), NSURL.URLWithString("about:blank"))
        timer = NSTimer.scheduledTimerWithTimeInterval(0.1, true, function () {
          if (settled || evaluating) return
          if (Date.now() - startedAt > RASTER_TIMEOUT_MS) {
            finish(createError("raster-timeout", "手写转图片超时"))
            return
          }
          evaluating = true
          var statusScript = 'JSON.stringify({status:window.__MNKBInkStatus||"",error:window.__MNKBInkError||"",result:window.__MNKBInkResult||"",width:window.__MNKBInkWidth||0,height:window.__MNKBInkHeight||0})'
          try {
            webView.evaluateJavaScript(statusScript, function (rawState) {
              evaluating = false
              if (settled || !rawState) return
              var state = null
              try { state = JSON.parse(String(rawState)) } catch (_) { return }
              if (state.status === "ready" && !rasterStarted) {
                rasterStarted = true
                var startScript = "window.__MNKBInkRasterize(" + JSON.stringify(svgDataURI) + "," + RASTER_TARGET_LONG_EDGE + "," + RASTER_MAX_PIXELS + "," + RASTER_JPEG_QUALITY + ");true"
                try {
                  webView.evaluateJavaScript(startScript, function () {})
                } catch (error) {
                  finish(createError("raster-start-failed", "无法启动手写转图片：" + (error.message || error)))
                }
                return
              }
              if (state.status === "error") {
                finish(createError("raster-failed", "手写转图片失败：" + (state.error || "unknown")))
                return
              }
              if (state.status === "done") {
                try {
                  var rasterResult = dataURIToNSData(String(state.result || ""))
                  rasterResult.width = Number(state.width) || 0
                  rasterResult.height = Number(state.height) || 0
                  finish(null, rasterResult)
                } catch (error) {
                  finish(error)
                }
              }
            })
          } catch (_) {
            evaluating = false
          }
        })
      } catch (error) {
        finish(createError("raster-init-failed", "无法初始化手写转图片：" + (error.message || error)))
      }
    })
  }

  function enqueueRasterization(svgDataURI) {
    var task = rasterQueue.then(function () {
      return rasterizeDrawingDataURI(svgDataURI)
    }, function () {
      return rasterizeDrawingDataURI(svgDataURI)
    })
    rasterQueue = task.then(function () {}, function () {})
    return task
  }

  async function resolveManualImageInput(note) {
    var totalStartedAt = Date.now()
    var selected = selectManualInput(note)
    if (!selected) return null
    if (selected.kind === "paint") {
      var paintData = getMediaData(selected.mediaId)
      if (!paintData) throw createError("paint-media-missing", "找不到要识别的摘录或第一条图片评论")
      return {
        data: paintData,
        source: selected.source,
        mediaId: selected.mediaId,
        isHandwriting: false,
        mimeType: "image",
      }
    }

    var cached = getCachedRaster(selected.mediaId)
    if (cached) {
      logPerformance({
        mediaId: selected.mediaId,
        cacheHit: true,
        parseMs: 0,
        rasterMs: 0,
        totalMs: Date.now() - totalStartedAt,
        imageBytes: cached.byteLength || 0,
        width: cached.width || 0,
        height: cached.height || 0,
      })
      return {
        data: cached.data,
        source: selected.source,
        mediaId: selected.mediaId,
        isHandwriting: true,
        mimeType: "image/jpeg",
        cacheHit: true,
        imageBytes: cached.byteLength || 0,
        width: cached.width || 0,
        height: cached.height || 0,
      }
    }

    var parseStartedAt = Date.now()
    var rendered = renderDrawingDataURI(getMediaBase64(selected.mediaId))
    var parseMs = Date.now() - parseStartedAt
    var rasterStartedAt = Date.now()
    var rasterized = await enqueueRasterization(rendered.dataURI)
    var rasterMs = Date.now() - rasterStartedAt
    setCachedRaster(selected.mediaId, rasterized)
    logPerformance({
      mediaId: selected.mediaId,
      cacheHit: false,
      parseMs: parseMs,
      rasterMs: rasterMs,
      totalMs: Date.now() - totalStartedAt,
      imageBytes: rasterized.byteLength || 0,
      width: rasterized.width || 0,
      height: rasterized.height || 0,
      strokeCount: rendered.strokeCount,
      pointCount: rendered.pointCount,
    })
    return {
      data: rasterized.data,
      source: selected.source,
      mediaId: selected.mediaId,
      isHandwriting: true,
      mimeType: "image/jpeg",
      cacheHit: false,
      imageBytes: rasterized.byteLength || 0,
      width: rasterized.width || 0,
      height: rasterized.height || 0,
      strokeCount: rendered.strokeCount,
      pointCount: rendered.pointCount,
      bounds: rendered.bounds,
    }
  }

  return {
    renderDrawingDataURI: renderDrawingDataURI,
    selectManualInput: selectManualInput,
    resolveManualImageInput: resolveManualImageInput,
  }
})()
