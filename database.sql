-- Create database
CREATE DATABASE json_translation_api;
\c json_translation_api;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create api_keys table
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create subscription_plans table
CREATE TABLE subscription_plans (
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
CREATE TABLE user_subscriptions (
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
CREATE TABLE usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
    characters_count INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create daily_usage_stats table
CREATE TABLE daily_usage_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    characters_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
);

-- Create translation_requests table
CREATE TABLE translation_requests (
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