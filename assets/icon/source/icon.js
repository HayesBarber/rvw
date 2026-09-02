const iconConfiguration = Object.freeze({
  canvasSize: 1024,
  bodyInset: 100,
  bodyRadius: 185,
  label: 'rvw',
})

const fontPresets = Object.freeze([
  {
    name: 'SF Mono',
    stack: '"SF Mono", "SFMono-Semibold", ui-monospace, monospace',
    weight: 600,
  },
  { name: 'Menlo', stack: 'Menlo, ui-monospace, monospace', weight: 700 },
  { name: 'Avenir Next', stack: '"Avenir Next", sans-serif', weight: 700 },
  {
    name: 'Avenir Next Condensed',
    stack: '"Avenir Next Condensed", "Arial Narrow", sans-serif',
    weight: 900,
  },
  { name: 'Futura', stack: 'Futura, sans-serif', weight: 700 },
  { name: 'Helvetica Neue', stack: '"Helvetica Neue", sans-serif', weight: 700 },
  {
    name: 'Arial Rounded MT Bold',
    stack: '"Arial Rounded MT Bold", sans-serif',
    weight: 700,
  },
  { name: 'Arial Black', stack: '"Arial Black", sans-serif', weight: 900 },
])

const defaultTypography = Object.freeze({
  fontName: 'SF Mono',
  fontWeight: 600,
  labelWidth: 530,
  verticalOffset: -8,
})

const typography = { ...defaultTypography }

const defaultArtwork = Object.freeze({
  mode: 'text',
  svgName: '',
  svgSource: '',
  svgSize: 480,
})

const artwork = { ...defaultArtwork }

const defaultColors = Object.freeze({
  background: '#000000',
  foreground: '#ffffff',
})

const colors = { ...defaultColors }

const sourceCanvas = document.querySelector('#icon-source')
const downloadButton = document.querySelector('#download-source')
const renderStatus = document.querySelector('#render-status')
const pageWordmark = document.querySelector('h1')
const fontFamilyInput = document.querySelector('#font-family')
const fontWeightInput = document.querySelector('#font-weight')
const labelWidthInput = document.querySelector('#label-width')
const labelOffsetInput = document.querySelector('#label-offset')
const labelWidthOutput = document.querySelector('#label-width-output')
const labelOffsetOutput = document.querySelector('#label-offset-output')
const selectedTypeface = document.querySelector('#selected-typeface')
const selectedWordmark = document.querySelector('#selected-wordmark')
const selectedArtwork = document.querySelector('#selected-artwork')
const selectedColors = document.querySelector('#selected-colors')
const typefaceSpecification = document.querySelector('#typeface-specification')
const wordmarkSpecification = document.querySelector('#wordmark-specification')
const fontPresetContainer = document.querySelector('#font-presets')
const backgroundColorInput = document.querySelector('#background-color')
const backgroundColorOutput = document.querySelector('#background-color-output')
const foregroundColorInput = document.querySelector('#foreground-color')
const foregroundColorOutput = document.querySelector('#foreground-color-output')
const artworkModeButtons = document.querySelectorAll('[data-artwork-mode]')
const wordmarkControls = document.querySelector('#wordmark-controls')
const svgControls = document.querySelector('#svg-controls')
const svgFileInput = document.querySelector('#svg-file')
const svgFileStatus = document.querySelector('#svg-file-status')
const svgSizeInput = document.querySelector('#svg-size')
const svgSizeOutput = document.querySelector('#svg-size-output')
const resetDesignButton = document.querySelector('#reset-design')

let renderRequest = 0
let fontInputTimer

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

function findPreset(fontName) {
  const normalizedName = fontName.trim().toLowerCase()
  return fontPresets.find(({ name }) => name.toLowerCase() === normalizedName)
}

function sanitizedFontName(fontName) {
  return fontName.replace(/[\\"';]/g, '').trim() || defaultTypography.fontName
}

function currentFontStack() {
  const preset = findPreset(typography.fontName)
  return preset?.stack ?? `"${sanitizedFontName(typography.fontName)}", sans-serif`
}

function fontDescription(size) {
  return `${typography.fontWeight} ${size}px ${currentFontStack()}`
}

function fittedFontSize(context) {
  const trialSize = 320
  context.font = fontDescription(trialSize)
  const trialWidth = context.measureText(iconConfiguration.label).width
  return (trialSize * typography.labelWidth) / trialWidth
}

function drawSource(svgImage = null) {
  const context = sourceCanvas.getContext('2d', { alpha: true })
  const bodySize = iconConfiguration.canvasSize - iconConfiguration.bodyInset * 2

  context.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height)
  context.fillStyle = colors.background
  roundedRectangle(
    context,
    iconConfiguration.bodyInset,
    iconConfiguration.bodyInset,
    bodySize,
    bodySize,
    iconConfiguration.bodyRadius,
  )
  context.fill()

  if (artwork.mode === 'svg') {
    if (!svgImage) return

    const imageRatio = svgImage.naturalWidth / svgImage.naturalHeight || 1
    const width = imageRatio >= 1 ? artwork.svgSize : artwork.svgSize * imageRatio
    const height = imageRatio >= 1 ? artwork.svgSize / imageRatio : artwork.svgSize
    context.drawImage(
      svgImage,
      (iconConfiguration.canvasSize - width) / 2,
      (iconConfiguration.canvasSize - height) / 2,
      width,
      height,
    )
    return
  }

  context.fillStyle = colors.foreground
  context.font = fontDescription(fittedFontSize(context))
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'

  const metrics = context.measureText(iconConfiguration.label)
  const textBaseline =
    iconConfiguration.canvasSize / 2 +
    (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2 +
    typography.verticalOffset

  context.fillText(iconConfiguration.label, iconConfiguration.canvasSize / 2, textBaseline)
}

function sanitizedSvgSource(source) {
  const svgDocument = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (svgDocument.querySelector('parsererror')) {
    throw new Error('the selected file is not valid SVG')
  }

  const svg = svgDocument.documentElement
  if (svg.localName !== 'svg') {
    throw new Error('the selected file does not contain an SVG root element')
  }

  svg.querySelectorAll('script, foreignObject').forEach((element) => element.remove())
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith('on')) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  if (!svg.hasAttribute('xmlns')) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  return new XMLSerializer().serializeToString(svg)
}

function loadSvgImage() {
  const coloredSource = artwork.svgSource.replaceAll(/currentColor/gi, colors.foreground)
  const sourceBlob = new Blob([coloredSource], { type: 'image/svg+xml' })
  const sourceURL = URL.createObjectURL(sourceBlob)

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => {
      URL.revokeObjectURL(sourceURL)
      resolve(image)
    })
    image.addEventListener('error', () => {
      URL.revokeObjectURL(sourceURL)
      reject(new Error('the selected SVG could not be rendered'))
    })
    image.src = sourceURL
  })
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
    context.drawImage(sourceCanvas, 0, 0, size, size)
  }
}

function downloadSource() {
  sourceCanvas.toBlob((blob) => {
    if (!blob) {
      renderStatus.textContent = 'Unable to encode the source PNG.'
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
  const request = ++renderRequest

  updateControls()
  downloadButton.disabled = true

  if (artwork.mode === 'svg') {
    if (!artwork.svgSource) {
      drawSource()
      updatePreviews()
      renderStatus.textContent = 'Choose an SVG file to render the icon.'
      return
    }

    const svgImage = await loadSvgImage()
    if (request !== renderRequest) return

    drawSource(svgImage)
    updatePreviews()
    renderStatus.textContent = `Ready · ${artwork.svgName} · centered at ${artwork.svgSize}px`
    downloadButton.disabled = false
    return
  }

  const fontName = sanitizedFontName(typography.fontName)
  const fontQuery = `${typography.fontWeight} 320px "${fontName}"`

  await document.fonts.ready
  await document.fonts.load(fontQuery)
  if (request !== renderRequest) return

  drawSource()
  updatePreviews()

  const fontAvailable = document.fonts.check(fontQuery)
  renderStatus.textContent = fontAvailable
    ? `Ready · ${fontName} · weight ${typography.fontWeight}`
    : `Ready · ${fontName} was unavailable, so its fallback was used`
  downloadButton.disabled = false
}

function signedPixels(value) {
  if (value === 0) return '0px'
  return `${value < 0 ? '−' : '+'}${Math.abs(value)}px`
}

function updateControls() {
  const fontStack = currentFontStack()
  const usingSvg = artwork.mode === 'svg'

  fontFamilyInput.value = typography.fontName
  fontFamilyInput.style.fontFamily = fontStack
  fontFamilyInput.style.fontWeight = typography.fontWeight
  fontWeightInput.value = String(typography.fontWeight)
  labelWidthInput.value = String(typography.labelWidth)
  labelOffsetInput.value = String(typography.verticalOffset)
  labelWidthOutput.textContent = `${typography.labelWidth}px`
  labelOffsetOutput.textContent = signedPixels(typography.verticalOffset)
  selectedTypeface.textContent = `${typography.fontName} · ${typography.fontWeight}`
  selectedWordmark.textContent = `${typography.labelWidth}px · ${signedPixels(typography.verticalOffset)}`
  selectedArtwork.textContent = usingSvg
    ? artwork.svgSource
      ? `SVG · ${artwork.svgName} · ${artwork.svgSize}px`
      : 'SVG · no file selected'
    : `Text · ${iconConfiguration.label}`
  backgroundColorInput.value = colors.background
  backgroundColorOutput.textContent = colors.background.toUpperCase()
  foregroundColorInput.value = colors.foreground
  foregroundColorOutput.textContent = colors.foreground.toUpperCase()
  selectedColors.textContent = `${colors.background.toUpperCase()} · ${colors.foreground.toUpperCase()}`
  wordmarkControls.hidden = usingSvg
  svgControls.hidden = !usingSvg
  typefaceSpecification.hidden = usingSvg
  wordmarkSpecification.hidden = usingSvg
  svgSizeInput.value = String(artwork.svgSize)
  svgSizeOutput.textContent = `${artwork.svgSize}px`
  svgFileStatus.textContent = artwork.svgName
    ? `${artwork.svgName} · centered automatically`
    : 'Choose an SVG with no background or text. Lucide currentColor strokes use the foreground color below.'
  sourceCanvas.setAttribute(
    'aria-label',
    usingSvg && artwork.svgName
      ? `rvw application icon using ${artwork.svgName}`
      : 'rvw application icon using the rvw wordmark',
  )
  pageWordmark.style.fontFamily = fontStack
  pageWordmark.style.fontWeight = typography.fontWeight

  for (const button of artworkModeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.artworkMode === artwork.mode))
  }

  for (const button of fontPresetContainer.querySelectorAll('.font-option')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.fontName === typography.fontName),
    )
  }
}

function selectArtworkMode(mode) {
  artwork.mode = mode
  requestRender()
}

function selectFont(fontName, usePresetWeight = false) {
  const preset = findPreset(fontName)
  typography.fontName = preset?.name ?? sanitizedFontName(fontName)
  if (preset && usePresetWeight) typography.fontWeight = preset.weight
  requestRender()
}

function requestRender() {
  render().catch((error) => {
    renderStatus.textContent = `Unable to render icon: ${error.message}`
  })
}

function createFontPresetButtons() {
  for (const preset of fontPresets) {
    const button = document.createElement('button')
    button.className = 'font-option'
    button.type = 'button'
    button.dataset.fontName = preset.name
    button.setAttribute('aria-pressed', 'false')
    button.setAttribute('aria-label', `Use ${preset.name}`)

    const sample = document.createElement('span')
    sample.className = 'font-option-sample'
    sample.textContent = iconConfiguration.label
    sample.style.fontFamily = preset.stack
    sample.style.fontWeight = preset.weight

    const name = document.createElement('span')
    name.className = 'font-option-name'
    name.textContent = preset.name

    button.append(sample, name)
    button.addEventListener('click', () => selectFont(preset.name, true))
    fontPresetContainer.append(button)
  }
}

fontFamilyInput.addEventListener('input', () => {
  clearTimeout(fontInputTimer)
  fontInputTimer = setTimeout(() => selectFont(fontFamilyInput.value), 150)
})

fontFamilyInput.addEventListener('change', () => {
  clearTimeout(fontInputTimer)
  selectFont(fontFamilyInput.value, true)
})

fontWeightInput.addEventListener('change', () => {
  typography.fontWeight = Number(fontWeightInput.value)
  requestRender()
})

labelWidthInput.addEventListener('input', () => {
  typography.labelWidth = Number(labelWidthInput.value)
  requestRender()
})

labelOffsetInput.addEventListener('input', () => {
  typography.verticalOffset = Number(labelOffsetInput.value)
  requestRender()
})

backgroundColorInput.addEventListener('input', () => {
  colors.background = backgroundColorInput.value
  requestRender()
})

foregroundColorInput.addEventListener('input', () => {
  colors.foreground = foregroundColorInput.value
  requestRender()
})

for (const button of artworkModeButtons) {
  button.addEventListener('click', () => selectArtworkMode(button.dataset.artworkMode))
}

svgFileInput.addEventListener('change', async () => {
  const [file] = svgFileInput.files
  if (!file) return

  downloadButton.disabled = true
  renderStatus.textContent = `Reading ${file.name}…`

  try {
    artwork.svgSource = sanitizedSvgSource(await file.text())
    artwork.svgName = file.name
    artwork.mode = 'svg'
    requestRender()
  } catch (error) {
    renderStatus.textContent = `Unable to use SVG: ${error.message}`
  }
})

svgSizeInput.addEventListener('input', () => {
  artwork.svgSize = Number(svgSizeInput.value)
  requestRender()
})

resetDesignButton.addEventListener('click', () => {
  Object.assign(typography, defaultTypography)
  Object.assign(artwork, defaultArtwork)
  Object.assign(colors, defaultColors)
  svgFileInput.value = ''
  requestRender()
})

downloadButton.addEventListener('click', downloadSource)
createFontPresetButtons()
requestRender()
