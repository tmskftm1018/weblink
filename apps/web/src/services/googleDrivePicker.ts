import { GoogleDrivePickerConfig } from './connections'

export type GoogleDrivePickerSelection = { id: string; name: string }

type PickerResponse = {
  action?: string
  docs?: Array<{ id?: string; name?: string }>
}

type PickerBuilder = {
  addView(view: string): PickerBuilder
  enableFeature(feature: string): PickerBuilder
  setAppId(appId: string): PickerBuilder
  setDeveloperKey(apiKey: string): PickerBuilder
  setOAuthToken(accessToken: string): PickerBuilder
  setTitle(title: string): PickerBuilder
  setCallback(callback: (response: PickerResponse) => void): PickerBuilder
  build(): { setVisible(visible: boolean): void }
}

type GooglePickerWindow = Window & {
  gapi?: { load(name: string, options: { callback: () => void; onerror: () => void }): void }
  google?: { picker?: { Action: { PICKED: string; CANCEL: string }; Feature: { MULTISELECT_ENABLED: string }; ViewId: { DOCS: string }; PickerBuilder: new () => PickerBuilder } }
}

let pickerScript: Promise<void> | null = null

function loadPickerScript(): Promise<void> {
  const page = window as GooglePickerWindow
  if (page.gapi) return Promise.resolve()
  if (pickerScript) return pickerScript
  pickerScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.async = true
    script.defer = true
    script.dataset.googlePicker = 'true'
    script.onload = () => page.gapi ? resolve() : reject(new Error('Google Picker를 불러오지 못했습니다.'))
    script.onerror = () => reject(new Error('Google Picker 스크립트에 연결하지 못했습니다.'))
    document.head.append(script)
  }).catch((cause: unknown) => {
    pickerScript = null
    throw cause
  })
  return pickerScript!
}

export async function pickGoogleDriveFiles(config: GoogleDrivePickerConfig): Promise<GoogleDrivePickerSelection[] | null> {
  await loadPickerScript()
  const page = window as GooglePickerWindow
  const gapi = page.gapi
  if (!gapi) throw new Error('Google Picker를 사용할 수 없습니다.')
  await new Promise<void>((resolve, reject) => gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker를 초기화하지 못했습니다.')) }))
  const pickerApi = page.google?.picker
  if (!pickerApi) throw new Error('Google Drive 파일 선택기를 사용할 수 없습니다.')

  return new Promise<GoogleDrivePickerSelection[] | null>((resolve) => {
    const picker = new pickerApi.PickerBuilder()
      .addView(pickerApi.ViewId.DOCS)
      .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
      .setAppId(config.app_id)
      .setDeveloperKey(config.api_key)
      .setOAuthToken(config.access_token)
      .setTitle('WebLink 프로젝트로 가져올 파일 선택')
      .setCallback((response) => {
        if (response.action === pickerApi.Action.PICKED) {
          const documents = (response.docs ?? []).filter((document): document is { id: string; name: string } => Boolean(document.id && document.name))
          resolve(documents.map((document) => ({ id: document.id, name: document.name })))
        } else if (response.action === pickerApi.Action.CANCEL) {
          resolve(null)
        }
      })
      .build()
    picker.setVisible(true)
  })
}
