import { getDatabase } from './mongodb';
import { getRepoEnvVariables, updateRepositoryDeployment, createLog } from './models';
import { createRailwayProject, createRailwayService, setRailwayVariables, triggerRailwayDeploy, restartRailwayService } from './railway';

/**
 * Executes a Blue-Green Zero-Downtime Migration for a repository
 * from an expiring Railway account to a target fresh account.
 */
export async function migrateRepoToNewAccount(repo, targetAccount) {
    const db = await getDatabase();
    const repoId = repo.repoId;

    await createLog({
        type: 'MIGRATION_STARTED',
        message: `Starting zero-downtime migration for repo ${repo.repoName} to new account ${targetAccount.accountId}`,
        metadata: { repoId, oldAccountId: repo.assignedAccountId, targetAccountId: targetAccount.accountId }
    });

    try {
        // 1. Fetch strictly linked environment variables from MongoDB
        const { variables } = await getRepoEnvVariables(repoId);

        // 2. Create new Project on Target Railway Account
        const newProject = await createRailwayProject(targetAccount.apiToken, `${repo.repoName}-migrated`);

        // 3. Create Service connected to the GitHub repo
        const newService = await createRailwayService(
            targetAccount.apiToken,
            newProject.projectId,
            repo.repoName,
            repo.githubUrl
        );

        // 4. Inject Environment Variables into new container
        await setRailwayVariables(
            targetAccount.apiToken,
            newProject.projectId,
            newProject.environmentId,
            newService.id,
            variables
        );

        // 5. Trigger deployment on the new service
        await triggerRailwayDeploy(targetAccount.apiToken, newService.id, newProject.environmentId);

        // 6. Update repository record to link to new account & project
        await updateRepositoryDeployment(repoId, {
            assignedAccountId: targetAccount.accountId,
            railwayProjectId: newProject.projectId,
            railwayServiceId: newService.id,
            deploymentStatus: 'MIGRATED_ONLINE',
            migratedAt: new Date()
        });

        // 7. Increment active slot on target account
        await db.collection('accounts').updateOne(
            { accountId: targetAccount.accountId },
            { $inc: { activeProjectsCount: 1 } }
        );

        // 8. Decrement slot on old account & mark migration complete
        if (repo.assignedAccountId) {
            await db.collection('accounts').updateOne(
                { accountId: repo.assignedAccountId },
                { $inc: { activeProjectsCount: -1 } }
            );
        }

        await createLog({
            type: 'MIGRATION_SUCCESS',
            message: `Migration succeeded for ${repo.repoName}. Zero downtime achieved!`,
            metadata: { repoId, newProjectId: newProject.projectId }
        });

        return { success: true, newProjectId: newProject.projectId };
    } catch (e) {
        await createLog({
            type: 'MIGRATION_FAILED',
            message: `Migration failed for ${repo.repoName}: ${e.message}`,
            metadata: { repoId, error: e.message }
        });
        throw e;
    }
}
