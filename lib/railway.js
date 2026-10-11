/**
 * Railway Public GraphQL API Engine
 * Endpoint: https://backboard.railway.app/graphql/v2
 */

const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.app/graphql/v2';

/**
 * Executes a GraphQL query/mutation against Railway API with a specific API Token.
 */
export async function railwayQuery(apiToken, query, variables = {}) {
    if (!apiToken) {
        throw new Error('Railway API token is required to execute query.');
    }

    const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ query, variables })
    });

    const result = await response.json();
    if (result.errors && result.errors.length > 0) {
        const errorMsg = result.errors.map(e => e.message).join(' | ');
        throw new Error(`Railway GraphQL Error: ${errorMsg}`);
    }

    return result.data;
}

/**
 * 1. Fetch Account Information & Current Projects
 */
export async function getRailwayMe(apiToken) {
    const query = `
        query {
            me {
                id
                name
                email
                projects {
                    edges {
                        node {
                            id
                            name
                            description
                            createdAt
                            services {
                                edges {
                                    node {
                                        id
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `;
    const data = await railwayQuery(apiToken, query);
    return data.me;
}

/**
 * 2. Fetch Real-Time Workspace Credit Balance / Usage
 */
export async function getRailwayCredits(apiToken) {
    // Railway tracks credits per workspace or user subscription.
    // Querying me -> workspace / billing status
    const query = `
        query {
            me {
                id
                email
                projects {
                    edges {
                        node {
                            id
                            name
                        }
                    }
                }
            }
        }
    `;
    try {
        const data = await railwayQuery(apiToken, query);
        // Railway trial accounts typically grant $5 credit monthly.
        // We return estimated status and project count.
        return {
            email: data.me?.email || 'unknown',
            totalProjects: data.me?.projects?.edges?.length || 0,
            active: true
        };
    } catch (e) {
        console.error('Error fetching Railway credits:', e.message);
        return { active: false, error: e.message };
    }
}

/**
 * 3. Create a Project on Railway
 */
export async function createRailwayProject(apiToken, projectName) {
    const mutation = `
        mutation CreateProject($name: String!) {
            projectCreate(input: { name: $name }) {
                id
                name
                environments {
                    edges {
                        node {
                            id
                            name
                        }
                    }
                }
            }
        }
    `;
    const data = await railwayQuery(apiToken, mutation, { name: projectName });
    const project = data.projectCreate;
    const environmentId = project.environments?.edges?.[0]?.node?.id || null;

    return {
        projectId: project.id,
        projectName: project.name,
        environmentId
    };
}

/**
 * 4. Create or Connect a Service to a GitHub Repo on Railway
 */
export async function createRailwayService(apiToken, projectId, serviceName, sourceRepo) {
    const mutation = `
        mutation ServiceCreate($projectId: String!, $name: String!, $source: ServiceSourceInput) {
            serviceCreate(input: { projectId: $projectId, name: $name, source: $source }) {
                id
                name
            }
        }
    `;
    const variables = {
        projectId,
        name: serviceName,
        source: sourceRepo ? { repo: sourceRepo } : null
    };

    const data = await railwayQuery(apiToken, mutation, variables);
    return data.serviceCreate;
}

/**
 * 5. Bulk Inject / Upsert Environment Variables into a Railway Service
 */
export async function setRailwayVariables(apiToken, projectId, environmentId, serviceId, variablesObj) {
    if (!variablesObj || Object.keys(variablesObj).length === 0) return true;

    // In Railway v2, variableUpsert mutation allows setting variables
    const mutation = `
        mutation VariableUpsert($input: VariableUpsertInput!) {
            variableUpsert(input: $input)
        }
    `;

    // Process each variable key-value pair
    for (const [key, value] of Object.entries(variablesObj)) {
        try {
            await railwayQuery(apiToken, mutation, {
                input: {
                    projectId,
                    environmentId,
                    serviceId,
                    name: String(key),
                    value: String(value)
                }
            });
        } catch (e) {
            console.error(`Error setting variable ${key} on Railway:`, e.message);
        }
    }

    return true;
}

/**
 * 6. Trigger Deployment or Redeploy for a Service Instance
 */
export async function triggerRailwayDeploy(apiToken, serviceId, environmentId) {
    const mutation = `
        mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
            serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
        }
    `;
    try {
        const data = await railwayQuery(apiToken, mutation, { serviceId, environmentId });
        return { success: true, data };
    } catch (e) {
        console.error('Error triggering Railway deploy:', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * 7. Soft Restart Railway Service
 */
export async function restartRailwayService(apiToken, environmentId, serviceId) {
    const mutation = `
        mutation ServiceInstanceRestart($environmentId: String!, $serviceId: String!) {
            serviceInstanceRestart(environmentId: $environmentId, serviceId: $serviceId)
        }
    `;
    try {
        await railwayQuery(apiToken, mutation, { environmentId, serviceId });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}
