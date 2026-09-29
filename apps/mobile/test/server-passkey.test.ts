import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { base64url, fromBase64url } from '../src/server/client'
import { assertionBody, creationOptions, registrationBody, requestOptions, PasskeyUnsupported } from '../src/server/passkey'

const buf = (...b: number[]) => new Uint8Array(b).buffer

describe('패스키 요청 변환', () => {
  test('base64url 은 패딩 없이 오가고 되돌아온다', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 250) % 256)
      const text = base64url(data)
      assert.doesNotMatch(text, /[+/=]/)
      assert.deepEqual(fromBase64url(text), data)
    }
  })

  test('서버 옵션을 브라우저 옵션으로: 사용자 확인 필수, ES256, 기기에 저장되는 패스키', () => {
    const o = creationOptions({
      challenge: base64url(new Uint8Array([1, 2, 3])),
      rp: { id: 'app.example', name: '근무표' },
      user: { id: base64url(new Uint8Array(16).fill(7)), name: '근무표 abcd', displayName: '근무표' },
      excludeCredentials: [base64url(new Uint8Array([9, 9]))],
      timeoutMs: 300000,
    })
    assert.deepEqual([...new Uint8Array(o.challenge as ArrayBuffer)], [1, 2, 3])
    assert.equal((o.user.id as Uint8Array).length, 16)
    assert.deepEqual(o.pubKeyCredParams, [{ type: 'public-key', alg: -7 }])
    assert.equal(o.authenticatorSelection?.userVerification, 'required')
    assert.equal(o.authenticatorSelection?.residentKey, 'required')
    assert.equal(o.attestation, 'none')
    assert.deepEqual([...(o.excludeCredentials![0].id as Uint8Array)], [9, 9])
    const r = requestOptions({ challenge: base64url(new Uint8Array([4])), rpId: 'app.example', timeoutMs: 1 })
    assert.equal(r.rpId, 'app.example')
    assert.equal(r.userVerification, 'required')
    assert.equal(r.allowCredentials, undefined, '계정을 묻지 않는 패스키 로그인')
  })

  test('브라우저 응답을 서버 요청으로', () => {
    const reg = registrationBody({
      rawId: buf(1, 2),
      response: {
        clientDataJSON: buf(3), getAuthenticatorData: () => buf(4), getPublicKey: () => buf(5),
        getPublicKeyAlgorithm: () => -7,
      } as unknown as AuthenticatorAttestationResponse,
    })
    assert.deepEqual(reg, { credentialId: 'AQI', clientDataJson: 'Aw', authenticatorData: 'BA', publicKey: 'BQ', publicKeyAlg: -7 })
    assert.throws(() => registrationBody({
      rawId: buf(1),
      response: { clientDataJSON: buf(3), getPublicKey: () => null } as unknown as AuthenticatorAttestationResponse,
    }), PasskeyUnsupported)
    const login = assertionBody({
      rawId: buf(1, 2),
      response: { clientDataJSON: buf(3), authenticatorData: buf(4), signature: buf(6), userHandle: buf(7) } as unknown as AuthenticatorAssertionResponse,
    })
    assert.deepEqual(login, { credentialId: 'AQI', clientDataJson: 'Aw', authenticatorData: 'BA', signature: 'Bg', userHandle: 'Bw' })
  })
})
