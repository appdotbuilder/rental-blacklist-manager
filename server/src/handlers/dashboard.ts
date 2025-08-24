import { db } from '../db';
import { usersTable, companiesTable, blacklistEntriesTable, activityLogsTable } from '../db/schema';
import { type DashboardAnalytics } from '../schema';
import { eq, and, gte, lte, count, desc, SQL } from 'drizzle-orm';

export async function getDashboardAnalytics(userId: number): Promise<DashboardAnalytics> {
  try {
    // 1. Get user's company ID
    const company = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.user_id, userId))
      .limit(1)
      .execute();

    if (!company || company.length === 0) {
      throw new Error('Company not found for user');
    }

    const companyId = company[0].id;

    // 2. Get total entries count
    const totalEntriesResult = await db.select({ count: count() })
      .from(blacklistEntriesTable)
      .where(eq(blacklistEntriesTable.company_id, companyId))
      .execute();

    const total_entries = totalEntriesResult[0].count;

    // 3. Count entries by status
    const activeBlacklistedResult = await db.select({ count: count() })
      .from(blacklistEntriesTable)
      .where(and(
        eq(blacklistEntriesTable.company_id, companyId),
        eq(blacklistEntriesTable.status, 'active'),
        eq(blacklistEntriesTable.is_blacklisted, true)
      ))
      .execute();

    const pendingEntriesResult = await db.select({ count: count() })
      .from(blacklistEntriesTable)
      .where(and(
        eq(blacklistEntriesTable.company_id, companyId),
        eq(blacklistEntriesTable.status, 'pending')
      ))
      .execute();

    const resolvedEntriesResult = await db.select({ count: count() })
      .from(blacklistEntriesTable)
      .where(and(
        eq(blacklistEntriesTable.company_id, companyId),
        eq(blacklistEntriesTable.status, 'resolved')
      ))
      .execute();

    const active_blacklisted = activeBlacklistedResult[0].count;
    const pending_entries = pendingEntriesResult[0].count;
    const resolved_entries = resolvedEntriesResult[0].count;

    // 4. Calculate risk score distribution
    const riskRanges = [
      { range: '0-20', min: 0, max: 20 },
      { range: '21-40', min: 21, max: 40 },
      { range: '41-60', min: 41, max: 60 },
      { range: '61-80', min: 61, max: 80 },
      { range: '81-100', min: 81, max: 100 }
    ];

    const risk_score_distribution = [];

    for (const range of riskRanges) {
      const rangeResult = await db.select({ count: count() })
        .from(blacklistEntriesTable)
        .where(and(
          eq(blacklistEntriesTable.company_id, companyId),
          gte(blacklistEntriesTable.blacklist_score, range.min),
          lte(blacklistEntriesTable.blacklist_score, range.max)
        ))
        .execute();

      risk_score_distribution.push({
        range: range.range,
        count: rangeResult[0].count
      });
    }

    // 5. Get recent activities
    const recent_activities = await getRecentActivity(userId, 5);

    return {
      total_entries,
      active_blacklisted,
      pending_entries,
      resolved_entries,
      risk_score_distribution,
      recent_activities
    };
  } catch (error) {
    console.error('Dashboard analytics retrieval failed:', error);
    throw error;
  }
}

export async function getRecentActivity(userId: number, limit: number = 10): Promise<DashboardAnalytics['recent_activities']> {
  try {
    // 1. Get user's company ID
    const company = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.user_id, userId))
      .limit(1)
      .execute();

    if (!company || company.length === 0) {
      throw new Error('Company not found for user');
    }

    const companyId = company[0].id;

    // 2. Query activity logs for the company with user data
    const activities = await db.select({
      id: activityLogsTable.id,
      action: activityLogsTable.action,
      resource_type: activityLogsTable.resource_type,
      user_first_name: usersTable.first_name,
      user_last_name: usersTable.last_name,
      created_at: activityLogsTable.created_at
    })
      .from(activityLogsTable)
      .innerJoin(usersTable, eq(activityLogsTable.user_id, usersTable.id))
      .innerJoin(companiesTable, eq(usersTable.id, companiesTable.user_id))
      .where(eq(companiesTable.id, companyId))
      .orderBy(desc(activityLogsTable.created_at))
      .limit(limit)
      .execute();

    // 3. Format the results
    return activities.map(activity => ({
      id: activity.id,
      action: activity.action,
      resource_type: activity.resource_type,
      user_name: `${activity.user_first_name} ${activity.user_last_name}`,
      created_at: activity.created_at
    }));
  } catch (error) {
    console.error('Recent activity retrieval failed:', error);
    throw error;
  }
}