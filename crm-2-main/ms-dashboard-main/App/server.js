const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Helper function to read JSON file
async function readJsonFile(filename) {
  try {
    const data = await fs.readFile(filename, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    return null;
  }
}

// Helper function to write JSON file
async function writeJsonFile(filename, data) {
  try {
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
    return false;
  }
}

// Helper function to log activity
async function logActivity(type, message, userId, entityType, entityId, meta = {}) {
  try {
    const crmData = await readJsonFile('crm-data.json');
    const newActivity = {
      id: crmData.activities.length + 1,
      type,
      message,
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      meta,
      created_at: new Date().toISOString()
    };
    
    crmData.activities.unshift(newActivity); // Add to beginning
    await writeJsonFile('crm-data.json', crmData);
    return newActivity;
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// Helper function to get date range
function getDateRange(period = '7d') {
  const now = new Date();
  const startDate = new Date();
  
  switch (period) {
    case '1d':
      startDate.setDate(now.getDate() - 1);
      break;
    case '7d':
      startDate.setDate(now.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(now.getDate() - 30);
      break;
    case '90d':
      startDate.setDate(now.getDate() - 90);
      break;
    default:
      startDate.setDate(now.getDate() - 7);
  }
  
  return { startDate, endDate: now };
}

// Main Dashboard API - Returns all metrics in one call
app.get('/api/dashboard', async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    const crmData = await readJsonFile('crm-data.json');
    const { startDate, endDate } = getDateRange(period);
    
    // Calculate metrics
    const newLeads = crmData.leads.filter(lead => 
      lead.status === 'new' && 
      new Date(lead.created_at) >= startDate
    ).length;
    
    const revenueTotal = crmData.deals
      .filter(deal => 
        deal.stage === 'closed_won' && 
        deal.closed_at && 
        new Date(deal.closed_at) >= startDate
      )
      .reduce((sum, deal) => sum + deal.value, 0);
    
    const pipelineValue = crmData.deals
      .filter(deal => !['closed_won', 'closed_lost'].includes(deal.stage))
      .reduce((sum, deal) => sum + deal.value, 0);
    
    const pendingTasks = crmData.tasks.filter(task => task.status !== 'done').length;
    
    // Generate revenue series for charts
    const revenueSeries = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayRevenue = crmData.deals
        .filter(deal => 
          deal.stage === 'closed_won' && 
          deal.closed_at && 
          deal.closed_at.startsWith(dateStr)
        )
        .reduce((sum, deal) => sum + deal.value, 0);
      
      revenueSeries.push({
        date: dateStr,
        value: dayRevenue
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Get recent activities
    const recentActivities = crmData.activities
      .slice(0, 20)
      .map(activity => {
        const user = crmData.users.find(u => u.id === activity.user_id);
        return {
          ...activity,
          user_name: user ? user.name : 'Unknown User'
        };
      });
    
    res.json({
      metrics: {
        new_leads: newLeads,
        revenue_total: revenueTotal,
        pipeline_value: pipelineValue,
        pending_tasks: pendingTasks
      },
      charts: {
        revenue_series: revenueSeries
      },
      recent_activities: recentActivities
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Leads API with filtering
app.get('/api/leads', async (req, res) => {
  try {
    const { status, period, page = 1, limit = 10 } = req.query;
    const crmData = await readJsonFile('crm-data.json');
    
    let filteredLeads = crmData.leads;
    
    // Filter by status
    if (status) {
      filteredLeads = filteredLeads.filter(lead => lead.status === status);
    }
    
    // Filter by period
    if (period) {
      const { startDate } = getDateRange(period);
      filteredLeads = filteredLeads.filter(lead => 
        new Date(lead.created_at) >= startDate
      );
    }
    
    // Calculate pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedLeads = filteredLeads.slice(startIndex, endIndex);
    
    // Add user information
    const leadsWithUsers = paginatedLeads.map(lead => {
      const owner = crmData.users.find(u => u.id === lead.owner_id);
      return {
        ...lead,
        owner_name: owner ? owner.name : 'Unknown'
      };
    });
    
    res.json({
      leads: leadsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredLeads.length,
        pages: Math.ceil(filteredLeads.length / limit)
      }
    });
  } catch (error) {
    console.error('Leads API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Deals API with filtering
app.get('/api/deals', async (req, res) => {
  try {
    const { stage, period, page = 1, limit = 10 } = req.query;
    const crmData = await readJsonFile('crm-data.json');
    
    let filteredDeals = crmData.deals;
    
    // Filter by stage
    if (stage) {
      filteredDeals = filteredDeals.filter(deal => deal.stage === stage);
    }
    
    // Filter by period
    if (period) {
      const { startDate } = getDateRange(period);
      filteredDeals = filteredDeals.filter(deal => 
        new Date(deal.created_at) >= startDate
      );
    }
    
    // Calculate pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedDeals = filteredDeals.slice(startIndex, endIndex);
    
    // Add user and lead information
    const dealsWithDetails = paginatedDeals.map(deal => {
      const owner = crmData.users.find(u => u.id === deal.owner_id);
      const lead = deal.lead_id ? crmData.leads.find(l => l.id === deal.lead_id) : null;
      
      return {
        ...deal,
        owner_name: owner ? owner.name : 'Unknown',
        lead_name: lead ? lead.name : null
      };
    });
    
    res.json({
      deals: dealsWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredDeals.length,
        pages: Math.ceil(filteredDeals.length / limit)
      }
    });
  } catch (error) {
    console.error('Deals API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Tasks API with filtering
app.get('/api/tasks', async (req, res) => {
  try {
    const { status, assigned_to, page = 1, limit = 10 } = req.query;
    const crmData = await readJsonFile('crm-data.json');
    
    let filteredTasks = crmData.tasks;
    
    // Filter by status
    if (status) {
      filteredTasks = filteredTasks.filter(task => task.status === status);
    }
    
    // Filter by assigned user
    if (assigned_to) {
      filteredTasks = filteredTasks.filter(task => task.assigned_to === parseInt(assigned_to));
    }
    
    // Calculate pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTasks = filteredTasks.slice(startIndex, endIndex);
    
    // Add user information
    const tasksWithUsers = paginatedTasks.map(task => {
      const assignedUser = crmData.users.find(u => u.id === task.assigned_to);
      return {
        ...task,
        assigned_user_name: assignedUser ? assignedUser.name : 'Unknown'
      };
    });
    
    res.json({
      tasks: tasksWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredTasks.length,
        pages: Math.ceil(filteredTasks.length / limit)
      }
    });
  } catch (error) {
    console.error('Tasks API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Activities API with filtering
app.get('/api/activities', async (req, res) => {
  try {
    const { limit = 20, after } = req.query;
    const crmData = await readJsonFile('crm-data.json');
    
    let filteredActivities = crmData.activities;
    
    // Filter by date
    if (after) {
      const afterDate = new Date(after);
      filteredActivities = filteredActivities.filter(activity => 
        new Date(activity.created_at) > afterDate
      );
    }
    
    // Limit results
    const limitedActivities = filteredActivities.slice(0, parseInt(limit));
    
    // Add user information
    const activitiesWithUsers = limitedActivities.map(activity => {
      const user = crmData.users.find(u => u.id === activity.user_id);
      return {
        ...activity,
        user_name: user ? user.name : 'Unknown User'
      };
    });
    
    res.json({
      activities: activitiesWithUsers
    });
  } catch (error) {
    console.error('Activities API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create new lead
app.post('/api/leads', async (req, res) => {
  try {
    const { name, contact, phone, source, value, owner_id } = req.body;
    const crmData = await readJsonFile('crm-data.json');
    
    const newLead = {
      id: crmData.leads.length + 1,
      name,
      contact,
      phone,
      source,
      status: 'new',
      owner_id: parseInt(owner_id),
      value: parseInt(value) || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    crmData.leads.push(newLead);
    await writeJsonFile('crm-data.json', crmData);
    
    // Log activity
    await logActivity(
      'lead_created',
      `New lead: ${name} from ${source}`,
      owner_id,
      'lead',
      newLead.id,
      { source, value: newLead.value }
    );
    
    res.json({ success: true, lead: newLead });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create new deal
app.post('/api/deals', async (req, res) => {
  try {
    const { title, lead_id, value, stage, owner_id } = req.body;
    const crmData = await readJsonFile('crm-data.json');
    
    const newDeal = {
      id: crmData.deals.length + 1,
      title,
      lead_id: lead_id ? parseInt(lead_id) : null,
      value: parseInt(value),
      stage,
      owner_id: parseInt(owner_id),
      created_at: new Date().toISOString(),
      closed_at: null
    };
    
    crmData.deals.push(newDeal);
    
    // Update lead status if converting from lead
    if (lead_id) {
      const lead = crmData.leads.find(l => l.id === parseInt(lead_id));
      if (lead) {
        lead.status = 'converted';
        lead.updated_at = new Date().toISOString();
      }
    }
    
    await writeJsonFile('crm-data.json', crmData);
    
    // Log activity
    await logActivity(
      'deal_created',
      `New deal: ${title}`,
      owner_id,
      'deal',
      newDeal.id,
      { value: newDeal.value, stage }
    );
    
    res.json({ success: true, deal: newDeal });
  } catch (error) {
    console.error('Create deal error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create new task
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, description, assigned_to, due_date, related_entity_type, related_entity_id } = req.body;
    const crmData = await readJsonFile('crm-data.json');
    
    const newTask = {
      id: crmData.tasks.length + 1,
      title,
      description,
      assigned_to: parseInt(assigned_to),
      due_date,
      status: 'pending',
      related_entity_type,
      related_entity_id: related_entity_id ? parseInt(related_entity_id) : null,
      created_at: new Date().toISOString()
    };
    
    crmData.tasks.push(newTask);
    await writeJsonFile('crm-data.json', crmData);
    
    // Log activity
    await logActivity(
      'task_created',
      `Task created: ${title}`,
      assigned_to,
      'task',
      newTask.id,
      { due_date, assigned_to: newTask.assigned_to }
    );
    
    res.json({ success: true, task: newTask });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update task status
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const crmData = await readJsonFile('crm-data.json');
    
    const task = crmData.tasks.find(t => t.id === parseInt(id));
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    
    const oldStatus = task.status;
    task.status = status;
    
    await writeJsonFile('crm-data.json', crmData);
    
    // Log activity
    await logActivity(
      'task_updated',
      `Task status updated: ${task.title} → ${status}`,
      task.assigned_to,
      'task',
      task.id,
      { old_status: oldStatus, new_status: status }
    );
    
    res.json({ success: true, task });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Users API
app.get('/api/users', async (req, res) => {
  try {
    const crmData = await readJsonFile('crm-data.json');
    res.json({ users: crmData.users });
  } catch (error) {
    console.error('Users API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Sales Module - Leads Management
app.get('/api/sales/leads', async (req, res) => {
  try {
    const { status, owner_id, page = 1, limit = 10 } = req.query;
    const crmData = await readJsonFile('crm-data.json');
    
    let filteredLeads = crmData.leads;
    
    if (status) {
      filteredLeads = filteredLeads.filter(lead => lead.status === status);
    }
    
    if (owner_id) {
      filteredLeads = filteredLeads.filter(lead => lead.owner_id === parseInt(owner_id));
    }
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedLeads = filteredLeads.slice(startIndex, endIndex);
    
    const leadsWithUsers = paginatedLeads.map(lead => {
      const owner = crmData.users.find(u => u.id === lead.owner_id);
      return {
        ...lead,
        owner_name: owner ? owner.name : 'Unknown'
      };
    });
    
    res.json({
      leads: leadsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredLeads.length,
        pages: Math.ceil(filteredLeads.length / limit)
      }
    });
  } catch (error) {
    console.error('Sales leads API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Sales Module - Deals Management
app.get('/api/sales/deals', async (req, res) => {
  try {
    const { stage, owner_id, page = 1, limit = 10 } = req.query;
    const crmData = await readJsonFile('crm-data.json');
    
    let filteredDeals = crmData.deals;
    
    if (stage) {
      filteredDeals = filteredDeals.filter(deal => deal.stage === stage);
    }
    
    if (owner_id) {
      filteredDeals = filteredDeals.filter(deal => deal.owner_id === parseInt(owner_id));
    }
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedDeals = filteredDeals.slice(startIndex, endIndex);
    
    const dealsWithDetails = paginatedDeals.map(deal => {
      const owner = crmData.users.find(u => u.id === deal.owner_id);
      const lead = deal.lead_id ? crmData.leads.find(l => l.id === deal.lead_id) : null;
      
      return {
        ...deal,
        owner_name: owner ? owner.name : 'Unknown',
        lead_name: lead ? lead.name : null
      };
    });
    
    res.json({
      deals: dealsWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredDeals.length,
        pages: Math.ceil(filteredDeals.length / limit)
      }
    });
  } catch (error) {
    console.error('Sales deals API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Sales Module - Tasks Management
app.get('/api/sales/tasks', async (req, res) => {
  try {
    const { status, assigned_to, page = 1, limit = 10 } = req.query;
    const crmData = await readJsonFile('crm-data.json');
    
    let filteredTasks = crmData.tasks;
    
    if (status) {
      filteredTasks = filteredTasks.filter(task => task.status === status);
    }
    
    if (assigned_to) {
      filteredTasks = filteredTasks.filter(task => task.assigned_to === parseInt(assigned_to));
    }
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTasks = filteredTasks.slice(startIndex, endIndex);
    
    const tasksWithUsers = paginatedTasks.map(task => {
      const assignedUser = crmData.users.find(u => u.id === task.assigned_to);
      return {
        ...task,
        assigned_user_name: assignedUser ? assignedUser.name : 'Unknown'
      };
    });
    
    res.json({
      tasks: tasksWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredTasks.length,
        pages: Math.ceil(filteredTasks.length / limit)
      }
    });
  } catch (error) {
    console.error('Sales tasks API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Legacy API endpoints for backward compatibility
app.get('/api/leads/count', async (req, res) => {
  try {
    const crmData = await readJsonFile('crm-data.json');
    const today = new Date().toISOString().split('T')[0];
    const thisWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const todayLeads = crmData.leads.filter(lead => 
      lead.created_at.split('T')[0] === today
    ).length;
    
    const weekLeads = crmData.leads.filter(lead => 
      lead.created_at.split('T')[0] >= thisWeek
    ).length;
    
    res.json({
      count: todayLeads,
      weekCount: weekLeads,
      total: crmData.leads.length
    });
  } catch (error) {
    console.error('Leads count API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/deals/count', async (req, res) => {
  try {
    const crmData = await readJsonFile('crm-data.json');
    const openDeals = crmData.deals.filter(deal => 
      !['closed_won', 'closed_lost'].includes(deal.stage)
    );
    const totalValue = openDeals.reduce((sum, deal) => sum + deal.value, 0);
    
    res.json({
      count: openDeals.length,
      totalValue: totalValue
    });
  } catch (error) {
    console.error('Deals count API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/revenue', async (req, res) => {
  try {
    const crmData = await readJsonFile('crm-data.json');
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const currentMonthRevenue = crmData.deals
      .filter(deal => 
        deal.stage === 'closed_won' && 
        deal.closed_at && 
        new Date(deal.closed_at).getMonth() === currentMonth &&
        new Date(deal.closed_at).getFullYear() === currentYear
      )
      .reduce((sum, deal) => sum + deal.value, 0);
    
    const previousMonthRevenue = crmData.deals
      .filter(deal => 
        deal.stage === 'closed_won' && 
        deal.closed_at && 
        new Date(deal.closed_at).getMonth() === (currentMonth - 1) &&
        new Date(deal.closed_at).getFullYear() === currentYear
      )
      .reduce((sum, deal) => sum + deal.value, 0);
    
    // Generate monthly data for charts
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const month = new Date(currentYear, currentMonth - i, 1);
      const monthRevenue = crmData.deals
        .filter(deal => 
          deal.stage === 'closed_won' && 
          deal.closed_at && 
          new Date(deal.closed_at).getMonth() === month.getMonth() &&
          new Date(deal.closed_at).getFullYear() === month.getFullYear()
        )
        .reduce((sum, deal) => sum + deal.value, 0);
      
      monthlyData.push({
        month: month.toLocaleDateString('en-US', { month: 'short' }),
        amount: monthRevenue
      });
    }
    
    res.json({
      currentMonth: currentMonthRevenue,
      previousMonth: previousMonthRevenue,
      monthlyData: monthlyData
    });
  } catch (error) {
    console.error('Revenue API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/tasks/count', async (req, res) => {
  try {
    const crmData = await readJsonFile('crm-data.json');
    const today = new Date().toISOString().split('T')[0];
    
    const pendingTasks = crmData.tasks.filter(task => task.status === 'pending');
    const dueToday = crmData.tasks.filter(task => 
      task.due_date.split('T')[0] === today && task.status !== 'done'
    );
    const overdue = crmData.tasks.filter(task => 
      task.due_date.split('T')[0] < today && task.status !== 'done'
    );
    
    res.json({
      count: pendingTasks.length,
      dueToday: dueToday.length,
      overdue: overdue.length
    });
  } catch (error) {
    console.error('Tasks count API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Existing routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/dashboard-stats', async (req, res) => {
  try {
    const crmData = await readJsonFile('crm-data.json');
    res.json({
      totalUsers: crmData.users.length,
      totalLeads: crmData.leads.length,
      totalDeals: crmData.deals.length,
      totalTasks: crmData.tasks.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

// Authentication routes
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const loginData = await readJsonFile('login.json');
    
    // Handle both loginRecords structure and simple array structure
    const users = loginData.loginRecords || loginData;
    
    const user = users.find(u => u.email === email && u.password === password);
    
    if (user) {
      res.json({ 
        success: true, 
        user: { 
          email: user.email, 
          name: user.username || user.name 
        } 
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const signupData = await readJsonFile('signup.json');
    
    // Handle both loginRecords structure and simple array structure
    const users = signupData.loginRecords || signupData;
    
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    const newUser = { 
      email, 
      password, 
      username: username, 
      userType: 'regular',
      loginTime: new Date().toISOString() 
    };
    
    if (signupData.loginRecords) {
      signupData.loginRecords.push(newUser);
    } else {
      signupData.push(newUser);
    }
    
    await writeJsonFile('signup.json', signupData);
    
    res.json({ success: true, message: 'User created successfully' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Legacy admin routes for backward compatibility
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const loginData = await readJsonFile('login.json');
    
    const user = loginData.find(u => u.email === email && u.password === password);
    
    if (user) {
      res.json({ success: true, user: { email: user.email, name: user.name } });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const signupData = await readJsonFile('signup.json');
    
    const existingUser = signupData.find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    const newUser = { email, password, name, created_at: new Date().toISOString() };
    signupData.push(newUser);
    await writeJsonFile('signup.json', signupData);
    
    res.json({ success: true, message: 'User created successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// General Chat routes
app.get('/api/chat/general', async (req, res) => {
  try {
    const chatData = await readJsonFile('general-chat.json');
    res.json(chatData);
  } catch (error) {
    // If file doesn't exist, return empty array
    res.json([]);
  }
});

app.post('/api/chat/general', async (req, res) => {
  try {
    const { from, message } = req.body;
    let chatData = [];
    
    try {
      chatData = await readJsonFile('general-chat.json');
    } catch (error) {
      // If file doesn't exist, start with empty array
      chatData = [];
    }
    
    const newMessage = {
      id: Date.now(),
      username: from,
      email: from,
      text: message,
      timestamp: new Date().toISOString()
    };
    
    chatData.push(newMessage);
    await writeJsonFile('general-chat.json', chatData);
    
    res.json({ success: true, message: newMessage });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send general message' });
  }
});

// Get all users for chat
app.get('/api/chat/users', async (req, res) => {
  try {
    const signupData = await readJsonFile('signup.json');
    const users = signupData.signupRecords || signupData;
    res.json({ users: users });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// Get private chat between two users
app.get('/api/chat/private/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const chatData = await readJsonFile('private-chats.json');
    
    // Create chat key (alphabetical order)
    const users = [user1, user2].sort();
    const chatKey = `privateChat_${users[0]}_${users[1]}`;
    
    const messages = chatData[chatKey] || [];
    res.json({ messages: messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load private chat' });
  }
});

// Send private message
app.post('/api/chat/private', async (req, res) => {
  try {
    const { from, to, message } = req.body;
    const chatData = await readJsonFile('private-chats.json');
    
    // Create chat key (alphabetical order)
    const users = [from, to].sort();
    const chatKey = `privateChat_${users[0]}_${users[1]}`;
    
    if (!chatData[chatKey]) {
      chatData[chatKey] = [];
    }
    
    const newMessage = {
      email: from,
      username: from,
      text: message,
      timestamp: new Date().toISOString()
    };
    
    chatData[chatKey].push(newMessage);
    await writeJsonFile('private-chats.json', chatData);
    
    res.json({ success: true, message: newMessage });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send private message' });
  }
});

// Legacy chat routes for backward compatibility (keeping for existing functionality)
app.get('/api/chat/history', async (req, res) => {
  try {
    const chatData = await readJsonFile('private-chats.json');
    res.json(chatData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load chat history' });
  }
});

app.post('/api/chat/message', async (req, res) => {
  try {
    const { from, to, message } = req.body;
    const chatData = await readJsonFile('private-chats.json');
    
    const newMessage = {
      id: Date.now(),
      from,
      to,
      message,
      timestamp: new Date().toISOString()
    };
    
    chatData.push(newMessage);
    await writeJsonFile('private-chats.json', chatData);
    
    res.json({ success: true, message: newMessage });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
