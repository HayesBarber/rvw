const iconConfiguration = Object.freeze({
  canvasSize: 1024,
  bodyInset: 100,
  bodyRadius: 185,
  bodyColor: '#000000',
  label: 'rvw',
  labelColor: '#ffffff',
  labelTargetWidth: 530,
  labelVerticalOffset: -8,
  fontFamily: '"SF Mono", "SFMono-Semibold", ui-monospace, monospace',
  fontWeight: 600,
})

const masterCanvas = document.querySelector('#icon-master')
const downloadButton = document.querySelector('#download-master')
const renderStatus = document.querySelector('#render-status')

function roundedRectangle(context, x, y, width, height, radius) {
  const right = x + width
  const bottom = y + height

  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(right - radius, y)
  context.quadraticCurveTo(right, y, right, y + radius)
  context.lineTo(right, bottom - radius)
  context.quadraticCurveTo(right, bottom, right - radius, bottom)
  context.lineTo(x + radius, bottom)
  context.quadraticCurveTo(x, bottom, x, bottom - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function fontDescription(size) {
  return `${iconConfiguration.fontWeight} ${size}px ${iconConfiguration.fontFamily}`
}

function fittedFontSize(context) {
  const trialSize = 320
  context.font = fontDescription(trialSize)
  const trialWidth = context.measureText(iconConfiguration.label).width
  return (trialSize * iconConfiguration.labelTargetWidth) / trialWidth
}

function drawMaster() {
  const context = masterCanvas.getContext('2d', { alpha: true })
  const bodySize = iconConfiguration.canvasSize - iconConfiguration.bodyInset * 2

  context.clearRect(0, 0, masterCanvas.width, masterCanvas.height)
  context.fillStyle = iconConfiguration.bodyColor
  roundedRectangle(
    context,
    iconConfiguration.bodyInset,
    iconConfiguration.bodyInset,
    bodySize,
    bodySize,
    iconConfiguration.bodyRadius,
  )
  context.fill()

  context.fillStyle = iconConfiguration.labelColor
  context.font = fontDescription(fittedFontSize(context))
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'

  const metrics = context.measureText(iconConfiguration.label)
  const textBaseline =
    iconConfiguration.canvasSize / 2 +
    (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2 +
    iconConfiguration.labelVerticalOffset

  context.fillText(iconConfiguration.label, iconConfiguration.canvasSize / 2, textBaseline)
}

function updatePreviews() {
  for (const [selector, size] of [
    ['#preview-128-light', 128],
    ['#preview-128-dark', 128],
    ['#preview-32', 32],
    ['#preview-16', 16],
  ]) {
    const preview = document.querySelector(selector)
    const context = preview.getContext('2d', { alpha: true })
    context.clearRect(0, 0, size, size)
    context.drawImage(masterCanvas, 0, 0, size, size)
  }
}

function downloadMaster() {
  masterCanvas.toBlob((blob) => {
    if (!blob) {
      renderStatus.textContent = 'Unable to encode the master PNG.'
      return
    }

    const downloadURL = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadURL
    link.download = 'rvw-icon-1024.png'
    link.click()
    URL.revokeObjectURL(downloadURL)
  }, 'image/png')
}

async function render() {
  await document.fonts.ready
  await document.fonts.load(`600 320px "SF Mono"`)

  drawMaster()
  updatePreviews()

  const hasSFMono = document.fonts.check(`600 320px "SF Mono"`)
  renderStatus.textContent = hasSFMono
    ? 'Ready · rendered with SF Mono Semibold'
    : 'Ready · SF Mono was unavailable, so the system monospace fallback was used'
  downloadButton.disabled = false
}

downloadButton.addEventListener('click', downloadMaster)
render().catch((error) => {
  renderStatus.textContent = `Unable to render icon: ${error.message}`
})
