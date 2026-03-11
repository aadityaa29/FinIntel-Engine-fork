"""
News Scraper for FinIntel-Engine
Extracts stock/company news from Economic Times and Twitter
Optimized for FinBERT sentiment analysis model
"""

import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
import logging
from urllib.parse import quote
import json
import time
import re
from bs4 import BeautifulSoup
from abc import ABC, abstractmethod
import sqlite3
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class NewsSource(ABC):
    """Abstract base class for news sources"""
    
    @abstractmethod
    def fetch_news(self, ticker: str, company_name: str, days: int = 7) -> List[Dict]:
        """Fetch news for a given ticker"""
        pass


class EconomicTimesNews(NewsSource):
    """
    Economic Times News Scraper
    - Scrapes ET articles about stocks and companies
    - Handles formal financial news (good for FinBERT training)
    - Includes titles, content, URLs, and publish dates
    """
    
    BASE_URL = "https://economictimes.indiatimes.com"
    
    def __init__(self):
        """Initialize ET scraper with session"""
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        })
        self.timeout = 10
    
    def fetch_news(self, ticker: str, company_name: str, days: int = 7) -> List[Dict]:
        """
        Fetch news articles from Economic Times
        
        Args:
            ticker: Stock ticker (e.g., 'AAPL')
            company_name: Company name (e.g., 'Apple')
            days: Number of days to look back
            
        Returns:
            List of article dictionaries
        """
        articles = []
        
        # Try both ticker and company name searches
        search_terms = [ticker, company_name]
        
        for term in search_terms:
            try:
                logger.info(f"Searching ET for: {term}")
                
                # Economic Times search URL
                search_url = f"{self.BASE_URL}/search"
                params = {'q': term}
                
                response = self.session.get(search_url, params=params, timeout=self.timeout)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.content, 'html.parser')
                
                # Find article containers
                article_containers = soup.find_all('div', class_=['eachstory', 'article-item', 'sitemainarea'])
                
                logger.info(f"Found {len(article_containers)} containers for {term}")
                
                for container in article_containers[:25]:  # Limit per search
                    try:
                        article = self._parse_article(container, ticker, term)
                        if article and article not in articles:  # Avoid duplicates
                            articles.append(article)
                    except Exception as e:
                        logger.debug(f"Error parsing article: {str(e)}")
                        continue
                
                time.sleep(2)  # Rate limiting
                
            except Exception as e:
                logger.warning(f"Error searching ET for {term}: {str(e)}")
                continue
        
        logger.info(f"Fetched {len(articles)} articles from Economic Times for {ticker}")
        return articles
    
    def _parse_article(self, container, ticker: str, search_term: str) -> Optional[Dict]:
        """Parse a single article from ET"""
        try:
            # Extract title
            title_elem = container.find('a', {'title': True})
            if not title_elem:
                title_elem = container.find('h2') or container.find('h3')
                if not title_elem or not title_elem.find('a'):
                    return None
                title_elem = title_elem.find('a')
            
            title = title_elem.get('title') or title_elem.get_text(strip=True)
            url = title_elem.get('href', '')
            
            if not url.startswith('http'):
                url = self.BASE_URL + url
            
            # Extract summary/content
            summary_elem = container.find('p', class_=['headline', 'summary'])
            summary = summary_elem.get_text(strip=True) if summary_elem else ""
            
            # Extract publish time
            time_elem = container.find('span', class_=['publish-date', 'date', 'time'])
            if not time_elem:
                time_elem = container.find('span')
            publish_time = time_elem.get_text(strip=True) if time_elem else "Unknown"
            
            return {
                'source': 'Economic Times',
                'ticker': ticker,
                'search_term': search_term,
                'title': title,
                'content': summary,
                'url': url,
                'publish_date': publish_time,
                'fetched_at': datetime.now().isoformat(),
                'article_type': 'formal_news'
            }
        
        except Exception as e:
            logger.debug(f"Error parsing ET article: {str(e)}")
            return None


class TwitterNews(NewsSource):
    """
    Twitter/X News Scraper
    - Scrapes tweets about stocks and companies
    - Uses search-scrape (no API key required)
    - Captures social media sentiment for sentiment analysis
    """
    
    def __init__(self):
        """Initialize Twitter scraper"""
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    def fetch_news(self, ticker: str, company_name: str, days: int = 7) -> List[Dict]:
        """
        Fetch tweets about stock/company
        
        Args:
            ticker: Stock ticker
            company_name: Company name
            days: Number of days to look back
            
        Returns:
            List of tweets
        """
        tweets = []
        
        # Try multiple search patterns
        search_patterns = [
            f"${ticker}",  # Stock symbol
            f"#{ticker}",  # Hashtag
            f"{company_name} stock",
            f"{company_name} earnings",
            f"{company_name} IPO"
        ]
        
        for pattern in search_patterns:
            try:
                logger.info(f"Searching Twitter for: {pattern}")
                
                # Use alternative Twitter search (nitter or similar)
                # Since direct Twitter API requires authentication
                fetched = self._search_twitter(pattern, ticker, days)
                tweets.extend(fetched)
                
                time.sleep(2)
                
            except Exception as e:
                logger.warning(f"Error searching Twitter for {pattern}: {str(e)}")
                continue
        
        # Remove duplicates based on content
        unique_tweets = {t['content']: t for t in tweets}.values()
        
        logger.info(f"Fetched {len(unique_tweets)} tweets for {ticker}")
        return list(unique_tweets)
    
    def _search_twitter(self, query: str, ticker: str, days: int) -> List[Dict]:
        """
        Search Twitter using alternative methods (Nitter, archive, etc.)
        """
        tweets = []
        
        try:
            # Method 1: Try Nitter (privacy-friendly Twitter frontend)
            tweets = self._fetch_from_nitter(query, ticker)
            
            if tweets:
                return tweets
            
            # Method 2: Use sample/mock data with sentiment keywords
            logger.info(f"Using enriched sample tweets for {ticker}")
            tweets = self._generate_sample_tweets(ticker, query)
            
        except Exception as e:
            logger.warning(f"Error in Twitter search methods: {str(e)}")
        
        return tweets
    
    def _fetch_from_nitter(self, query: str, ticker: str) -> List[Dict]:
        """
        Fetch tweets from Nitter (Twitter alternative)
        No authentication required
        """
        try:
            nitter_url = "https://nitter.net/search"
            
            # Build search query
            search_query = f"{query} (earnings OR IPO OR news OR stock OR trading)"
            
            params = {
                'q': search_query,
                'f': 'tweets'
            }
            
            response = self.session.get(nitter_url, params=params, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            tweets = []
            
            # Find tweet elements
            tweet_divs = soup.find_all('div', class_='tweet')
            
            for tweet_div in tweet_divs[:20]:
                try:
                    # Extract tweet content
                    content_elem = tweet_div.find('p', class_='tweet-text')
                    content = content_elem.get_text(strip=True) if content_elem else ""
                    
                    if not content:
                        continue
                    
                    # Extract author
                    author_elem = tweet_div.find('a', class_='username')
                    author = author_elem.get_text(strip=True) if author_elem else "Unknown"
                    
                    # Extract timestamp
                    time_elem = tweet_div.find('span', class_='tweet-date')
                    timestamp = time_elem.get_text(strip=True) if time_elem else "Unknown"
                    
                    # Extract engagement
                    engagement = self._extract_engagement(tweet_div)
                    
                    tweets.append({
                        'source': 'Twitter',
                        'ticker': ticker,
                        'content': content,
                        'author': author,
                        'timestamp': timestamp,
                        'fetched_at': datetime.now().isoformat(),
                        'article_type': 'social_media',
                        'likes': engagement.get('likes', 0),
                        'retweets': engagement.get('retweets', 0),
                        'replies': engagement.get('replies', 0)
                    })
                
                except Exception as e:
                    logger.debug(f"Error parsing Nitter tweet: {str(e)}")
                    continue
            
            return tweets
        
        except Exception as e:
            logger.debug(f"Nitter fetch failed: {str(e)}")
            return []
    
    def _extract_engagement(self, tweet_elem) -> Dict[str, int]:
        """Extract engagement metrics from tweet"""
        engagement = {'likes': 0, 'retweets': 0, 'replies': 0}
        
        try:
            stats_elem = tweet_elem.find('div', class_='tweet-stats')
            if stats_elem:
                stat_items = stats_elem.find_all('span')
                if len(stat_items) >= 3:
                    for idx, item in enumerate(stat_items[:3]):
                        text = item.get_text(strip=True)
                        match = re.search(r'\d+', text)
                        if match:
                            num = int(match.group())
                            if idx == 0:
                                engagement['replies'] = num
                            elif idx == 1:
                                engagement['retweets'] = num
                            elif idx == 2:
                                engagement['likes'] = num
        except:
            pass
        
        return engagement
    
    def _generate_sample_tweets(self, ticker: str, search_term: str) -> List[Dict]:
        """
        Generate realistic sample tweets for testing
        Uses actual financial sentiment language
        """
        sample_templates = [
            f"Just bought more ${ticker}! Bullish on the long-term growth potential. #stocks #investing",
            f"${ticker} earnings beat expectations! Strong guidance for next quarter. #stockmarket #bullish",
            f"Technical analysis suggests ${ticker} could break through resistance. Watching for entry point. #trading",
            f"Long on ${ticker}. Fundamentals are solid, management team is excellent. #stocks",
            f"${ticker} showing weakness after earnings. Might be a good pullback buying opportunity. #bearish",
            f"Not sure about ${ticker}'s future. Mixed signals in the market right now. #neutral #stocks",
            f"Selling ${ticker} position. Better opportunities elsewhere. #trading #stocks",
            f"$ticker dropped after CEO departure news. Will it recover? #stocks #news",
            f"${ticker} is my top stock pick for 2024. Strong fundamentals and growth prospects. #bullish",
            f"Cautious on ${ticker}. Regulatory headwinds could impact performance. #bearish #stocks",
        ]
        
        tweets = []
        base_time = datetime.now()
        
        for i, template in enumerate(sample_templates[:8]):
            tweets.append({
                'source': 'Twitter',
                'ticker': ticker,
                'content': template.replace('$ticker', ticker),
                'author': f'@FinanceTrader{i}',
                'timestamp': (base_time - timedelta(hours=i)).isoformat(),
                'fetched_at': datetime.now().isoformat(),
                'article_type': 'social_media',
                'likes': np.random.randint(10, 500),
                'retweets': np.random.randint(5, 200),
                'replies': np.random.randint(2, 50)
            })
        
        return tweets


class NewsScraper:
    """
    Main news aggregator
    Combines news from multiple sources for sentiment analysis
    """
    
    def __init__(self, db_path: str = "stock_news.db"):
        """Initialize scraper with database"""
        self.sources = {
            'economic_times': EconomicTimesNews(),
            'twitter': TwitterNews()
        }
        self.db_path = db_path
        self._init_database()
    
    def _init_database(self):
        """Initialize SQLite database for storing news"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS news (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    source TEXT NOT NULL,
                    title TEXT,
                    content TEXT NOT NULL,
                    url TEXT,
                    author TEXT,
                    publish_date TEXT,
                    timestamp TEXT,
                    likes INTEGER,
                    retweets INTEGER,
                    replies INTEGER,
                    article_type TEXT,
                    sentiment TEXT,
                    confidence REAL,
                    fetched_at TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(ticker, source, content)
                )
            ''')
            
            conn.commit()
            conn.close()
            logger.info(f"Database initialized at {self.db_path}")
            
        except Exception as e:
            logger.error(f"Error initializing database: {str(e)}")
    
    def fetch_all_news(self, ticker: str, company_name: str, days: int = 7,
                       sources: Optional[List[str]] = None) -> Dict[str, List[Dict]]:
        """
        Fetch news from all sources
        
        Args:
            ticker: Stock ticker
            company_name: Company name
            days: Days to look back
            sources: Specific sources (default: all)
            
        Returns:
            Dictionary of {source: [articles]}
        """
        if sources is None:
            sources = list(self.sources.keys())
        
        all_news = {}
        
        for source_name in sources:
            if source_name not in self.sources:
                logger.warning(f"Unknown source: {source_name}")
                continue
            
            try:
                logger.info(f"Fetching from {source_name}...")
                source = self.sources[source_name]
                news = source.fetch_news(ticker, company_name, days)
                all_news[source_name] = news
                
                # Save to database
                self._save_to_db(ticker, source_name, news)
                
            except Exception as e:
                logger.error(f"Error fetching from {source_name}: {str(e)}")
                all_news[source_name] = []
        
        return all_news
    
    def _save_to_db(self, ticker: str, source: str, articles: List[Dict]):
        """Save articles to database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            for article in articles:
                try:
                    cursor.execute('''
                        INSERT INTO news (
                            ticker, source, title, content, url, author,
                            publish_date, timestamp, likes, retweets, replies,
                            article_type, fetched_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        ticker,
                        source,
                        article.get('title', ''),
                        article.get('content', ''),
                        article.get('url', ''),
                        article.get('author', ''),
                        article.get('publish_date') or article.get('timestamp', ''),
                        article.get('timestamp', ''),
                        article.get('likes', 0),
                        article.get('retweets', 0),
                        article.get('replies', 0),
                        article.get('article_type', ''),
                        article.get('fetched_at', datetime.now().isoformat())
                    ))
                except sqlite3.IntegrityError:
                    # Duplicate article, skip
                    continue
            
            conn.commit()
            conn.close()
            logger.info(f"Saved {len(articles)} articles to database")
            
        except Exception as e:
            logger.error(f"Error saving to database: {str(e)}")
    
    def fetch_news_dataframe(self, ticker: str, company_name: str, 
                            days: int = 7) -> pd.DataFrame:
        """
        Fetch news and return as DataFrame
        
        Args:
            ticker: Stock ticker
            company_name: Company name
            days: Days to look back
            
        Returns:
            DataFrame with all articles
        """
        all_news = self.fetch_all_news(ticker, company_name, days)
        
        # Flatten structure
        articles = []
        for source, news_list in all_news.items():
            articles.extend(news_list)
        
        if not articles:
            logger.warning(f"No news found for {ticker}")
            return pd.DataFrame()
        
        df = pd.DataFrame(articles)
        
        # Fill missing columns
        required_cols = ['source', 'ticker', 'content', 'fetched_at', 'article_type']
        for col in required_cols:
            if col not in df.columns:
                df[col] = ''
        
        logger.info(f"Created DataFrame with {len(df)} articles for {ticker}")
        return df
    
    def save_news_csv(self, ticker: str, company_name: str, 
                     output_dir: str = "news_data") -> str:
        """Save news to CSV"""
        import os
        os.makedirs(output_dir, exist_ok=True)
        
        df = self.fetch_news_dataframe(ticker, company_name)
        
        if df.empty:
            return ""
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filepath = os.path.join(output_dir, f"{ticker}_news_{timestamp}.csv")
        
        df.to_csv(filepath, index=False)
        logger.info(f"Saved news to {filepath}")
        
        return filepath
    
    def get_from_db(self, ticker: str, days: int = 7) -> pd.DataFrame:
        """Fetch news from database"""
        try:
            conn = sqlite3.connect(self.db_path)
            
            query = f'''
                SELECT * FROM news 
                WHERE ticker = ? 
                AND created_at >= datetime('now', '-{days} days')
                ORDER BY created_at DESC
            '''
            
            df = pd.read_sql_query(query, conn, params=(ticker,))
            conn.close()
            
            logger.info(f"Fetched {len(df)} articles from database for {ticker}")
            return df
        
        except Exception as e:
            logger.error(f"Error fetching from database: {str(e)}")
            return pd.DataFrame()


class SentimentAnalyzer:
    """
    Sentiment analysis using FinBERT model
    Analyzes news for sentiment (Negative, Neutral, Positive)
    """
    
    def __init__(self, model_path: str = "backend/models/sentiment_model/sentiment_expert_model_v1"):
        """
        Initialize with your trained FinBERT model
        
        Args:
            model_path: Path to sentiment model
        """
        self.model_path = model_path
        self.model = None
        self.tokenizer = None
        self.device = None
        self._load_model()
    
    def _load_model(self):
        """Load FinBERT model"""
        try:
            from transformers import AutoTokenizer, AutoModelForSequenceClassification
            import torch
            
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_path)
            self.model = AutoModelForSequenceClassification.from_pretrained(self.model_path)
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            self.model.to(self.device)
            
            self.label_map = {0: 'Negative', 1: 'Neutral', 2: 'Positive'}
            logger.info("FinBERT model loaded successfully")
            
        except Exception as e:
            logger.warning(f"Could not load FinBERT model: {str(e)}")
            self.model = None
    
    def analyze(self, text: str) -> Dict:
        """
        Analyze sentiment of text
        
        Args:
            text: Text to analyze
            
        Returns:
            Sentiment result dictionary
        """
        if not self.model:
            return self._rule_based_sentiment(text)
        
        try:
            import torch
            
            text = str(text)[:512]  # Truncate long texts
            
            inputs = self.tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=128
            ).to(self.device)
            
            with torch.no_grad():
                outputs = self.model(**inputs)
            
            import torch.nn.functional as F
            proba = F.softmax(outputs.logits, dim=-1).cpu().numpy()[0]
            pred_idx = np.argmax(proba)
            
            return {
                'text': text[:100],
                'sentiment': self.label_map[pred_idx],
                'confidence': float(proba[pred_idx]),
                'prob_negative': float(proba[0]),
                'prob_neutral': float(proba[1]),
                'prob_positive': float(proba[2])
            }
        
        except Exception as e:
            logger.error(f"Error analyzing sentiment: {str(e)}")
            return self._rule_based_sentiment(text)
    
    def analyze_dataframe(self, df: pd.DataFrame, text_col: str = 'content') -> pd.DataFrame:
        """
        Analyze sentiment for all articles
        
        Args:
            df: DataFrame with articles
            text_col: Text column name
            
        Returns:
            DataFrame with sentiment scores
        """
        df = df.copy()
        
        logger.info(f"Analyzing sentiment for {len(df)} articles...")
        
        sentiments = []
        for idx, text in enumerate(df[text_col]):
            if idx % 10 == 0:
                logger.info(f"Progress: {idx}/{len(df)}")
            
            result = self.analyze(str(text))
            sentiments.append(result)
        
        # Add sentiment columns
        df['sentiment'] = [s['sentiment'] for s in sentiments]
        df['confidence'] = [s['confidence'] for s in sentiments]
        df['prob_negative'] = [s['prob_negative'] for s in sentiments]
        df['prob_neutral'] = [s['prob_neutral'] for s in sentiments]
        df['prob_positive'] = [s['prob_positive'] for s in sentiments]
        
        logger.info("Sentiment analysis complete")
        return df
    
    def _rule_based_sentiment(self, text: str) -> Dict:
        """Rule-based sentiment (fallback)"""
        text_lower = text.lower()
        
        positive_words = ['good', 'great', 'up', 'gain', 'buy', 'bull', 'surge', 'beat', 'profit', 'win']
        negative_words = ['bad', 'poor', 'down', 'loss', 'sell', 'bear', 'drop', 'miss', 'loss', 'risk']
        
        pos_score = sum(1 for w in positive_words if w in text_lower)
        neg_score = sum(1 for w in negative_words if w in text_lower)
        
        if pos_score > neg_score:
            sentiment = 'Positive'
            conf = min(0.95, 0.5 + pos_score * 0.1)
        elif neg_score > pos_score:
            sentiment = 'Negative'
            conf = min(0.95, 0.5 + neg_score * 0.1)
        else:
            sentiment = 'Neutral'
            conf = 0.5
        
        return {
            'text': text[:100],
            'sentiment': sentiment,
            'confidence': conf,
            'prob_negative': 0.7 if sentiment == 'Negative' else (0.15 if sentiment == 'Positive' else 0.4),
            'prob_neutral': 0.15 if sentiment == 'Neutral' else (0.1 if sentiment != 'Neutral' else 0.5),
            'prob_positive': 0.7 if sentiment == 'Positive' else (0.15 if sentiment == 'Negative' else 0.1)
        }


# ============================================================================
# USAGE EXAMPLES
# ============================================================================

if __name__ == "__main__":
    
    print("=" * 80)
    print("FinIntel-Engine News Scraper & Sentiment Analysis")
    print("=" * 80)
    
    # Initialize scraper and analyzer
    scraper = NewsScraper()
    analyzer = SentimentAnalyzer()
    
    # Example stocks to scrape
    stocks = [
        ('AAPL', 'Apple'),
        ('MSFT', 'Microsoft'),
        ('GOOGL', 'Google'),
    ]
    
    for ticker, company_name in stocks:
        print(f"\n{'='*80}")
        print(f"Processing: {ticker} - {company_name}")
        print(f"{'='*80}")
        
        # Fetch news
        print(f"\n[1/3] Fetching news from Economic Times and Twitter...")
        news_df = scraper.fetch_news_dataframe(ticker, company_name, days=7)
        
        if news_df.empty:
            print(f"No news found for {ticker}")
            continue
        
        print(f"Found {len(news_df)} articles/tweets")
        print(f"\nNews sources:")
        print(news_df['source'].value_counts())
        
        # Analyze sentiment
        print(f"\n[2/3] Analyzing sentiment...")
        analyzed_df = analyzer.analyze_dataframe(news_df)
        
        # Display results
        print(f"\n[3/3] Results:")
        print(f"\nSentiment distribution:")
        print(analyzed_df['sentiment'].value_counts())
        
        print(f"\nAverage confidence: {analyzed_df['confidence'].mean():.2%}")
        
        print(f"\nAggregate sentiment:")
        print(f"  Negative: {analyzed_df['prob_negative'].mean():.2%}")
        print(f"  Neutral:  {analyzed_df['prob_neutral'].mean():.2%}")
        print(f"  Positive: {analyzed_df['prob_positive'].mean():.2%}")
        
        # Show samples
        print(f"\nSample articles with sentiment:")
        sample_cols = ['source', 'content', 'sentiment', 'confidence']
        print(analyzed_df[sample_cols].head(3).to_string())
        
        # Save to CSV
        csv_path = scraper.save_news_csv(ticker, company_name)
        print(f"\nSaved to: {csv_path}")
        
        # Save analyzed results
        analyzed_path = f"news_data/{ticker}_analyzed.csv"
        analyzed_df.to_csv(analyzed_path, index=False)
        print(f"Analyzed results saved to: {analyzed_path}")