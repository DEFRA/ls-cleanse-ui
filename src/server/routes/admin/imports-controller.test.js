import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { signedInAsAdmin } from '#/test-helpers/sign-in.js'
import { uploadImportController } from './imports-controller.js'

describe('SPOL import assignment context', () => {
  const tenantId = randomUUID()
  const clientId = randomUUID()
  afterEach(() => {
    config.set('auth.mode', 'password')
    config.set('auth.entra.tenantId', '')
    config.set('auth.entra.clientId', '')
    vi.restoreAllMocks()
  })

  test.each(['entra', 'password'])(
    'supplies directory scope only in %s mode',
    async (mode) => {
      config.set('auth.mode', mode)
      config.set('auth.entra.tenantId', tenantId)
      config.set('auth.entra.clientId', clientId)
      const request = {
        payload: {
          file: {
            filename: 'spol.csv',
            payload: Buffer.from('Assigned to\nTest User')
          }
        },
        cleanse: {
          uploadImport: vi.fn().mockResolvedValue({ id: 'import-id' })
        },
        yar: { flash: vi.fn() }
      }
      const h = { redirect: vi.fn() }
      await uploadImportController.handler(request, h)
      const body = request.cleanse.uploadImport.mock.calls[0][0]
      if (mode === 'entra') {
        expect(body).toMatchObject({ tenantId, clientId })
      } else {
        expect(body).not.toHaveProperty('tenantId')
        expect(body).not.toHaveProperty('clientId')
      }
      expect(h.redirect).toHaveBeenCalledWith('/admin/imports/import-id')
    }
  )

  test('shows warnings without claiming the entire row was rejected and escapes details', async () => {
    const server = await createServer()
    await server.initialize()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes('/rejections')
              ? {
                  items: [
                    {
                      rowNumber: 2,
                      reason: 'AssigneeAmbiguous',
                      detail: '<Same Name>'
                    }
                  ],
                  totalCount: 1
                }
              : {
                  id: 'import-id',
                  fileName: 'spol.csv',
                  status: 'completed',
                  matched: 1
                }
          )
        )
    )
    try {
      const response = await server.inject({
        url: '/admin/imports/import-id',
        auth: signedInAsAdmin
      })
      expect(response.statusCode).toBe(200)
      expect(response.result).toContain('Import warnings and rejected rows')
      expect(response.result).toContain('Assignment warnings do not prevent')
      expect(response.result).toContain('&lt;Same Name&gt;')
      expect(response.result).not.toContain('1 row could not be applied')
    } finally {
      await server.stop({ timeout: 0 })
    }
  })
})
