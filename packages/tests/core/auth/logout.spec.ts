import Supertest from 'supertest'
import { setup, createAdminUser } from '../../helpers'

['mysql', 'sqlite'].forEach((databaseClient: any) => {
    test(`${databaseClient} - can successfully logout when administrator is logged in`, async () => {
        const { app, databaseClient: knex } = await setup()
    
        const client = Supertest(app)
    
        const user = await createAdminUser(knex)
    
        const cookie = (
            await client.post('/api/login').send({
                ...user,
                password: 'password',
            })
        ).header['set-cookie'][0]
            .split('=')[1]
            .split(';')[0]
    
        expect(await knex('sessions').select('*')).toHaveLength(1)
    
        const response = await client
            .post('/api/logout')
            .set('Cookie', [`connect.sid=${cookie};`])
    
        expect(response.header['set-cookie']).toBeFalsy()
        expect(await knex('sessions').select('*')).toHaveLength(0)
    })
})