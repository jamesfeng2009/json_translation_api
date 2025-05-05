-- CREATE DATABASE json_translation_api;
-- 已存在时无需重复创建

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP,
    stripe_customer_id VARCHAR(255),
    picture VARCHAR(512),
    provider VARCHAR(32) NOT NULL DEFAULT 'local',
    provider_id VARCHAR(255),
    subscription_plan_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_subscription_plan FOREIGN KEY (subscription_plan_id) REFERENCES subscription_plans(id)
);

-- Create api_keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create subscription_plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    tier VARCHAR(50) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    stripe_price_id VARCHAR(255),
    stripe_product_id VARCHAR(255),
    monthly_character_limit INTEGER NOT NULL,
    features TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create user_subscriptions table
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES subscription_plans(id) ON DELETE CASCADE,
    stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL,
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create usage_logs table
CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
    characters_count INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create daily_usage_stats table
CREATE TABLE IF NOT EXISTS daily_usage_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    characters_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
);

-- Create translation_requests table
CREATE TABLE IF NOT EXISTS translation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
    source_language VARCHAR(10) NOT NULL,
    target_language VARCHAR(10) NOT NULL,
    content TEXT NOT NULL,
    translated_content TEXT,
    status VARCHAR(50) NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create webhook_config table
CREATE TABLE IF NOT EXISTS webhook_config (
    id VARCHAR(36) PRIMARY KEY,
    user_id UUID NOT NULL,
    webhook_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create send_retry table
CREATE TABLE IF NOT EXISTS send_retry (
    id VARCHAR(36) PRIMARY KEY,
    webhook_id VARCHAR(36) NOT NULL,
    task_id VARCHAR(36) NOT NULL,
    attempt INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (webhook_id) REFERENCES webhook_config(id) ON DELETE CASCADE
);

-- Create usage_log table
CREATE TABLE usage_log (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    characters_count INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create payment_logs table
CREATE TABLE IF NOT EXISTS payment_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    order_id VARCHAR(64),
    stripe_payment_intent_id VARCHAR(255),
    event_type VARCHAR(64), -- created, succeeded, failed, refunded, webhook_received, etc.
    amount DECIMAL(10,2),
    currency VARCHAR(8),
    status VARCHAR(32), -- pending, succeeded, failed, refunded
    raw_data JSONB,     -- Stripe 回调原始数据或本地请求数据
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_api_keys_key ON api_keys(key);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_api_key_id ON usage_logs(api_key_id);
CREATE INDEX idx_daily_usage_stats_user_id ON daily_usage_stats(user_id);
CREATE INDEX idx_daily_usage_stats_date ON daily_usage_stats(date);
CREATE INDEX idx_translation_requests_user_id ON translation_requests(user_id);
CREATE INDEX idx_translation_requests_api_key_id ON translation_requests(api_key_id);
CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_plan_id ON user_subscriptions(plan_id);
CREATE INDEX idx_webhook_config_user_id ON webhook_config(user_id);
CREATE INDEX idx_send_retry_webhook_id ON send_retry(webhook_id);
CREATE INDEX idx_send_retry_created_at ON send_retry(created_at);
CREATE INDEX idx_payment_logs_user_id ON payment_logs(user_id);
CREATE INDEX idx_payment_logs_stripe_payment_intent_id ON payment_logs(stripe_payment_intent_id);
CREATE INDEX idx_payment_logs_event_type ON payment_logs(event_type);

-- Insert initial subscription plans
INSERT INTO subscription_plans (
    id, name, description, tier, price, monthly_character_limit, features
) VALUES
    (
        uuid_generate_v4(),
        'Free',
        'Basic translation features with limited usage',
        'free',
        0.00,
        10000,
        ARRAY[
            '10,000 characters per month',
            'Basic translation features',
            'Email support'
        ]
    ),
    (
        uuid_generate_v4(),
        'Hobby',
        'Perfect for small projects and personal use',
        'hobby',
        19.00,
        100000,
        ARRAY[
            '100,000 characters per month',
            'Priority support',
            'API access',
            'Webhook notifications'
        ]
    ),
    (
        uuid_generate_v4(),
        'Standard',
        'Ideal for growing businesses',
        'standard',
        99.00,
        1000000,
        ARRAY[
            '1,000,000 characters per month',
            'Priority support',
            'API access',
            'Webhook notifications',
            'Custom integrations'
        ]
    ),
    (
        uuid_generate_v4(),
        'Premium',
        'Enterprise-grade solution',
        'premium',
        399.00,
        10000000,
        ARRAY[
            '10,000,000 characters per month',
            '24/7 priority support',
            'API access',
            'Webhook notifications',
            'Custom integrations',
            'Dedicated account manager'
        ]
    );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscription_plans_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_subscriptions_updated_at
    BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_usage_stats_updated_at
    BEFORE UPDATE ON daily_usage_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_translation_requests_updated_at
    BEFORE UPDATE ON translation_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to check usage limit
CREATE OR REPLACE FUNCTION check_usage_limit(
    p_user_id UUID,
    p_characters_count INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    v_plan_limit INTEGER;
    v_current_usage INTEGER;
    v_subscription_status VARCHAR(50);
BEGIN
    -- Get user's subscription status and plan limit
    SELECT
        sp.monthly_character_limit,
        us.status
    INTO
        v_plan_limit,
        v_subscription_status
    FROM
        user_subscriptions us
        JOIN subscription_plans sp ON us.plan_id = sp.id
    WHERE
        us.user_id = p_user_id
        AND us.status = 'active'
        AND CURRENT_TIMESTAMP BETWEEN us.current_period_start AND us.current_period_end;

    -- If no valid subscription found, use free plan limit
    IF v_plan_limit IS NULL THEN
        SELECT monthly_character_limit INTO v_plan_limit
        FROM subscription_plans
        WHERE tier = 'free';
    END IF;

    -- Get current usage
    SELECT COALESCE(SUM(characters_count), 0) INTO v_current_usage
    FROM usage_logs
    WHERE user_id = p_user_id
    AND created_at >= date_trunc('month', CURRENT_TIMESTAMP);

    -- Check if usage exceeds limit
    RETURN (v_current_usage + p_characters_count) <= v_plan_limit;
END;
$$ LANGUAGE plpgsql;

-- Add comments to tables and columns
COMMENT ON TABLE webhook_config IS 'Webhook configuration table';
COMMENT ON TABLE send_retry IS 'Webhook send retry history table';
COMMENT ON COLUMN webhook_config.id IS 'Primary key';
COMMENT ON COLUMN webhook_config.user_id IS 'User ID who owns this webhook config';
COMMENT ON COLUMN webhook_config.webhook_url IS 'Webhook URL to send notifications';
COMMENT ON COLUMN webhook_config.created_at IS 'Record creation timestamp';
COMMENT ON COLUMN webhook_config.updated_at IS 'Record last update timestamp';
COMMENT ON COLUMN send_retry.id IS 'Primary key';
COMMENT ON COLUMN send_retry.webhook_id IS 'Reference to webhook_config';
COMMENT ON COLUMN send_retry.task_id IS 'Translation task ID';
COMMENT ON COLUMN send_retry.attempt IS 'Retry attempt number';
COMMENT ON COLUMN send_retry.status IS 'Retry status (success/failed)';
COMMENT ON COLUMN send_retry.payload IS 'Webhook payload data';
COMMENT ON COLUMN send_retry.created_at IS 'Record creation timestamp';
