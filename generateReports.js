import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;

async function fetchAllEvents() {
    let allData = [];
    let page = 1;
    let pageCount = 1;

    console.log('Fetching click events...');

    while (page <= pageCount) {
        const url = `${STRAPI_API_URL}/api/click-events?pagination[page]=${page}&pagination[pageSize]=100`;
        const res = await fetch(url, {
            headers: {
                Authorization: STRAPI_TOKEN
            }
        });
        
        if (!res.ok) {
            console.error('Failed to fetch:', res.status, res.statusText);
            break;
        }

        const json = await res.json();
        const data = json.data;
        const meta = json.meta;

        if (data && data.length > 0) {
            allData = allData.concat(data);
        }

        if (meta && meta.pagination) {
            pageCount = meta.pagination.pageCount;
        }
        
        console.log(`Fetched page ${page} of ${pageCount}`);
        page++;
    }

    console.log(`Total events fetched: ${allData.length}`);
    return allData;
}

function processStats(data, title) {
    if (data.length === 0) {
        return `# ${title}\n\nNo events found for this period.`;
    }

    const stats = {
        totalEvents: data.length,
        eventTypes: {},
        slugs: {},
        locales: {},
        utmSources: {},
        utmCampaigns: {},
        deviceTypes: {},
        countries: {},
        uniqueSessions: new Set(),
        uniqueIps: new Set(),
        fbModes: {},
        fbFireTypes: {},
        sessions: {}
    };

    data.forEach(item => {
        const attrs = item.attributes || item; // Strapi v4 returns { id, attributes }

        const evType = attrs.event_type || 'Unknown';
        stats.eventTypes[evType] = (stats.eventTypes[evType] || 0) + 1;

        const slug = attrs.prelend_slug || 'Unknown';
        stats.slugs[slug] = (stats.slugs[slug] || 0) + 1;

        const locale = attrs.locale || 'Unknown';
        stats.locales[locale] = (stats.locales[locale] || 0) + 1;

        const utmSource = attrs.utm_source || 'Unknown/Direct';
        stats.utmSources[utmSource] = (stats.utmSources[utmSource] || 0) + 1;

        const utmCampaign = attrs.utm_campaign || 'Unknown';
        stats.utmCampaigns[utmCampaign] = (stats.utmCampaigns[utmCampaign] || 0) + 1;

        const device = attrs.device_type || 'Unknown';
        stats.deviceTypes[device] = (stats.deviceTypes[device] || 0) + 1;

        const country = attrs.country || 'Unknown';
        stats.countries[country] = (stats.countries[country] || 0) + 1;

        const sessionId = attrs.session_id;
        if (sessionId) {
            stats.uniqueSessions.add(sessionId);
            if (!stats.sessions[sessionId]) {
                stats.sessions[sessionId] = new Set();
            }
            stats.sessions[sessionId].add(evType);
        }
        
        if (attrs.client_ip) stats.uniqueIps.add(attrs.client_ip);

        const fbMode = attrs.fb_pixel_mode || 'Unknown';
        stats.fbModes[fbMode] = (stats.fbModes[fbMode] || 0) + 1;

        const fbFire = attrs.fb_fire_type || 'Unknown';
        stats.fbFireTypes[fbFire] = (stats.fbFireTypes[fbFire] || 0) + 1;
    });

    // Calculate session funnel
    let sessionsWithView = 0;
    let sessionsWithCta = 0;
    let sessionsWithOutbound = 0;

    for (const [sId, events] of Object.entries(stats.sessions)) {
        if (events.has('prelend_view')) sessionsWithView++;
        if (events.has('cta_click')) sessionsWithCta++;
        if (events.has('outbound_click')) sessionsWithOutbound++;
    }

    const totalValidSessions = stats.uniqueSessions.size;
    
    // Percentages relative to total unique sessions
    const viewRate = totalValidSessions > 0 ? ((sessionsWithView / totalValidSessions) * 100).toFixed(2) : 0;
    const ctaRate  = totalValidSessions > 0 ? ((sessionsWithCta / totalValidSessions) * 100).toFixed(2) : 0;
    const outboundRate = totalValidSessions > 0 ? ((sessionsWithOutbound / totalValidSessions) * 100).toFixed(2) : 0;

    // Relative funnel
    const ctaFromView = sessionsWithView > 0 ? ((sessionsWithCta / sessionsWithView) * 100).toFixed(2) : 0;
    const outboundFromCta = sessionsWithCta > 0 ? ((sessionsWithOutbound / sessionsWithCta) * 100).toFixed(2) : 0;

    const formatDict = (dict) => {
        return Object.entries(dict)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `- **${k}**: ${v} (${((v / stats.totalEvents) * 100).toFixed(2)}%)`)
            .join('\n');
    };

    return `
# ${title}

## Session Funnel Depth (Воронка по сессиям)
- **Total Unique Sessions**: ${totalValidSessions}
- **Step 1: prelend_view**: ${sessionsWithView} sessions (${viewRate}% of all sessions)
- **Step 2: cta_click**: ${sessionsWithCta} sessions (${ctaRate}% of all sessions)
- **Step 3: outbound_click**: ${sessionsWithOutbound} sessions (${outboundRate}% of all sessions)

### Conversion Rates
- **View -> CTA Click**: ${ctaFromView}%
- **CTA Click -> Outbound Click**: ${outboundFromCta}%

## General Overview
- **Total Events**: ${stats.totalEvents}
- **Unique IP Addresses**: ${stats.uniqueIps.size}

## Event Types (Absolute counts)
${formatDict(stats.eventTypes)}

## Traffic Sources (utm_source)
${formatDict(stats.utmSources)}

## Campaigns (utm_campaign)
${formatDict(stats.utmCampaigns)}

## Top Prelanding Slugs
${formatDict(stats.slugs)}

## Geographic Distribution (Countries)
${formatDict(stats.countries)}

## Devices
${formatDict(stats.deviceTypes)}

## Locales
${formatDict(stats.locales)}

## FB Pixel Tracking Mode
${formatDict(stats.fbModes)}

## FB Event Fire Types
${formatDict(stats.fbFireTypes)}
`;
}

async function run() {
    try {
        const events = await fetchAllEvents();
        
        // Report 1: Total
        const totalReport = processStats(events, "Total Overall Click Events Report");
        fs.writeFileSync('../1_total_click_events_report.md', totalReport.trim());
        console.log('Saved 1_total_click_events_report.md');

        // Report 2: Last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentEvents = events.filter(ev => {
            const attrs = ev.attributes || ev;
            const dateStr = attrs.clicked_at || attrs.createdAt;
            if (!dateStr) return false;
            return new Date(dateStr) > twentyFourHoursAgo;
        });

        const recentReport = processStats(recentEvents, "Last 24 Hours Click Events Report");
        fs.writeFileSync('../2_last_24h_click_events_report.md', recentReport.trim());
        console.log('Saved 2_last_24h_click_events_report.md');

    } catch (e) {
        console.error("Error generating reports:", e);
    }
}

run();
