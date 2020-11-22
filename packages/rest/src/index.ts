import { Request, Response } from 'express'
import qs from 'qs'
import {
    FindOptions,
    FilterQuery,
    AnyEntity,
    EntityName
} from '@mikro-orm/core'
import AsyncHandler from 'express-async-handler'
import { responseEnhancer } from 'express-response-formatter'
import {
    plugin,
    route,
    ResourceContract,
    RouteContract,
    Field,
    FieldContract
} from '@tensei/common'

class Rest {
    private getApiPath = (apiPath: string, path: string) => {
        return `/${apiPath}/${path}`
    }

    private getPageMetaFromFindOptions(
        total: number,
        findOptions: FindOptions<any>
    ) {
        return {
            total,
            page:
                findOptions.offset ||
                (findOptions.offset === 0 && findOptions.limit)
                    ? Math.ceil((findOptions.offset + 1) / findOptions.limit!)
                    : null,
            per_page: findOptions.limit ? findOptions.limit : null,
            page_count: Math.ceil(total / findOptions.limit!)
        }
    }

    private parseQueryToFindOptions(query: any, resource: ResourceContract) {
        let findOptions: FindOptions<any> = {}

        if (query.page && query.page !== '-1') {
            findOptions.limit =
                parseInt(query.per_page) || resource.data.perPageOptions[0]
            findOptions.offset =
                query.page >= 1 ? (query.page - 1) * findOptions.limit : 0
        }

        if (query.populate) {
            findOptions.populate = query.populate.split(',')
        }

        if (query.fields) {
            findOptions.fields = query.fields.split(',')
        }

        if (query.filters) {
            findOptions.filters = query.filters
        }

        if (query.sort) {
            const sorters = query.sort
                .split(',')
                .map((sorter: string) => sorter.split(':')) as string[]

            sorters.forEach(([field, direction]) => {
                findOptions.orderBy = {
                    ...findOptions.orderBy,
                    [field]: direction as any
                }
            })
        }

        return findOptions
    }

    private parseQueryToWhereOptions(query: any) {
        let whereOptions: FilterQuery<any> = {}

        if (query.where) {
            const strigifiedQuery = qs.stringify(query.where, { encode: false })
            const parsedQuery = qs.parse(strigifiedQuery, {
                decoder(value) {
                    if (/^(\d+|\d*\.\d+)$/.test(value)) {
                        return parseFloat(value)
                    }

                    value = value.replace(/where/, '')

                    let keywords: any = {
                        true: true,
                        false: false,
                        null: null,
                        undefined: undefined
                    }
                    if (value in keywords) {
                        return keywords[value]
                    }

                    return value
                }
            })
            whereOptions = parsedQuery
        }

        return whereOptions
    }

    private getFieldDocsParameters(
        field: FieldContract,
        resources: ResourceContract[],
        location: 'query' | 'body' = 'body'
    ) {
        let properties: any = {
            required:
                !field.property.nullable && !field.relatedProperty.reference,
            name: field.databaseField,
            in: location,
            description: field.helpText
        }

        if (field.relatedProperty) {
            if (['m:n', '1:m'].includes(field.relatedProperty.reference!)) {
                properties.schema = {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                }

                properties.description =
                    field.helpText ||
                    `This should be an array of IDs of ${field.databaseField} to relate to this entity.`
            }
        }

        return properties
    }

    private extendRoutes(
        resources: ResourceContract[],
        getApiPath: (path: string) => string
    ) {
        const routes: RouteContract[] = []

        resources.forEach(resource => {
            const {
                slugSingular: singular,
                slugPlural: plural,
                pascalCaseName: modelName
            } = resource.data
            const fields = resource.data.fields.filter(f => !f.property.primary)

            routes.push(
                route(`Insert ${singular}`)
                    .post()
                    .internal()
                    .resource(resource)
                    .path(getApiPath(plural))
                    .extend({
                        docs: {
                            summary: `Insert a single ${singular}.`,
                            parameters: fields.map(field =>
                                this.getFieldDocsParameters(field, resources)
                            )
                        }
                    })
                    .handle(async ({ manager, body }, response) => {
                        const entity = manager.create(modelName, body)

                        await manager.persistAndFlush(entity)

                        return response.status(201).json(entity)
                    })
            )

            routes.push(
                route(`Insert multiple ${plural}`)
                    .post()
                    .internal()
                    .resource(resource)
                    .path(getApiPath(plural))
                    .extend({
                        docs: {
                            summary: `Insert multiple ${plural}.`,
                            description: `This endpoint inserts multiple ${plural}. Provide an array of objects containing the ${plural} you want to insert.`
                        }
                    })
                    .handle(async ({ manager, body }, response) => {
                        const entities = (
                            body.objects || []
                        ).map((object: any) =>
                            manager.create(modelName, object)
                        )

                        await manager.persistAndFlush(entities)

                        return response.formatter.created(entities)
                    })
            )

            routes.push(
                route(`Fetch multiple ${plural}`)
                    .get()
                    .internal()
                    .resource(resource)
                    .path(getApiPath(plural))
                    .extend({
                        docs: {
                            summary: `Fetch multiple ${plural}`,
                            description: `This endpoint fetches all ${plural} that match an optional where query.`
                        }
                    })
                    .handle(async ({ manager, query }, response) => {
                        const findOptions = this.parseQueryToFindOptions(
                            query,
                            resource
                        )
                        const whereOptions = this.parseQueryToWhereOptions(
                            query
                        )

                        const [entities, total] = await manager.findAndCount(
                            modelName,
                            whereOptions,
                            findOptions
                        )

                        return response.formatter.ok(
                            entities,
                            this.getPageMetaFromFindOptions(total, findOptions)
                        )
                    })
            )

            routes.push(
                route(`Fetch single ${singular}`)
                    .get()
                    .internal()
                    .resource(resource)
                    .extend({
                        docs: {
                            summary: `Fetch a single ${singular}`,
                            description: `This endpoint fetches a single ${singular}. Provide the primary key ID of the entity you want to fetch.`,
                            parameters: []
                        }
                    })
                    .path(getApiPath(`${plural}/:id`))
                    .handle(async ({ manager, params, query }, response) => {
                        const findOptions = this.parseQueryToFindOptions(
                            query,
                            resource
                        )

                        const entity = await manager.findOne(
                            modelName as EntityName<AnyEntity<any>>,
                            params.id as FilterQuery<AnyEntity<any>>,
                            findOptions
                        )

                        if (!entity) {
                            return response.formatter.notFound(
                                `could not find ${modelName} with ID ${params.id}`
                            )
                        }
                        return response.formatter.ok(entity)
                    })
            )

            routes.push(
                route(`Fetch ${singular} relations`)
                    .get()
                    .internal()
                    .resource(resource)
                    .extend({
                        docs: {
                            summary: `Fetch relation to a ${singular}`,
                            description: `This endpoint figures out the relationship passed as /:related-resource (one-to-one, one-to-many, many-to-many, or many-to-one) and returns all related entities. The result will be a paginated array for many-to-* relations and an object for one-to-* relations.`,
                            parameters: fields.map(field =>
                                this.getFieldDocsParameters(field, resources)
                            )
                        }
                    })
                    .path(getApiPath(`${plural}/:id/:related-resource`))
                    .handle(async ({ manager, params, query }, response) => {
                        const whereOptions = this.parseQueryToWhereOptions(
                            query
                        )
                        try {
                            const entity = await manager.findOne(
                                modelName as EntityName<AnyEntity<any>>,
                                params.id as FilterQuery<AnyEntity<any>>
                            )

                            await manager.populate(
                                entity,
                                params['related-resource'],
                                whereOptions
                            )
                            return response.formatter.ok(
                                entity?.[params['related-resource']]
                            )
                        } catch (error) {
                            if (error?.name === 'ValidationError') {
                                return response.formatter.notFound(
                                    `The ${modelName} model does not have a '${params['related-resource']}' property`
                                )
                            }
                            return response.formatter.badRequest({
                                message: 'The request was not understood.'
                            })
                        }
                    })
            )

            routes.push(
                route(`Update single ${singular}`)
                    .put()
                    .internal()
                    .resource(resource)
                    .extend({
                        docs: {
                            summary: `Update a single ${singular}`,
                            description: `This endpoint update a single ${singular}. Provide the primary key ID of the entity you want to delete.`
                        }
                    })
                    .path(getApiPath(`${plural}/:id`))
                    .handle(async ({ manager, params, body }, response) => {
                        const entity = manager.findOne(
                            modelName as EntityName<AnyEntity<any>>,
                            params.id as FilterQuery<AnyEntity<any>>
                        )

                        if (!entity) {
                            return response.formatter.notFound(
                                `Could not find ${resource.data.snakeCaseName} with ID of ${params.id}`
                            )
                        }

                        manager.assign(entity, body)

                        await manager.persistAndFlush(entity)

                        return response.formatter.ok(entity)
                    })
            )

            routes.push(
                route(`Delete single ${singular}`)
                    .delete()
                    .internal()
                    .resource(resource)
                    .path(getApiPath(`${plural}/:id`))
                    .extend({
                        docs: {
                            summary: `Delete a single ${singular}`,
                            description: `This endpoint deletes a single ${singular}. Provide the primary key ID of the entity you want to delete.`,
                            parameters: fields.map(field =>
                                this.getFieldDocsParameters(field, resources)
                            )
                        }
                    })
                    .handle(async ({ manager, params, body }, response) => {
                        const modelRepository = manager.getRepository(
                            modelName as EntityName<AnyEntity<any>>
                        )
                        const entity = modelRepository.findOne(
                            params.id as FilterQuery<AnyEntity<any>>
                        )

                        if (!entity) {
                            return response.formatter.notFound(
                                `Could not find resourceName with ID of ${params.id}`
                            )
                        }

                        await modelRepository.removeAndFlush(entity)
                        return response.formatter.noContent({})
                    })
            )
        })

        return routes
    }

    plugin() {
        return plugin('Rest API')
            .afterDatabaseSetup(
                async ({ extendRoutes, resources, apiPath, app }) => {
                    app.use(responseEnhancer())

                    app.use((request, response, next) => {
                        // @ts-ignore
                        request.req = request

                        return next()
                    })

                    app.use((request, response, next) => {
                        request.authenticationError = (
                            message: string = 'Unauthenticated.'
                        ) => ({
                            status: 401,
                            message
                        })

                        request.forbiddenError = (
                            message: string = 'Forbidden.'
                        ) => ({
                            status: 400,
                            message
                        })

                        request.validationError = (
                            message: string = 'Validation failed.'
                        ) => ({
                            status: 422,
                            message
                        })

                        request.userInputError = (
                            message: string = 'Validation failed.'
                        ) => ({
                            status: 422,
                            message
                        })

                        return next()
                    })

                    extendRoutes(
                        this.extendRoutes(resources, (path: string) =>
                            this.getApiPath(apiPath, path)
                        )
                    )
                }
            )
            .setup(async ({ app, routes }) => {
                routes.forEach(route => {
                    route.config.middleware.unshift(
                        async (request, response, next) => {
                            // @ts-ignore
                            request.req = request

                            return next()
                        }
                    )
                })

                routes.forEach(route => {
                    ;(app as any)[route.config.type.toLowerCase()](
                        route.config.path,
                        ...route.config.middleware.map(fn => AsyncHandler(fn)),
                        AsyncHandler(
                            async (request: Request, response: Response) =>
                                route.config.handler(request, response)
                        )
                    )
                })
            })
    }
}

export const rest = () => new Rest()
